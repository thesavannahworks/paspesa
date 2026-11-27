/**
 * Server schema (White Paper §37). The server keeps the authoritative ledger: balances are derived
 * from validated transactions, never taken from the client (§39.1). Idempotency is enforced by
 * primary keys and UNIQUE constraints (§25). Operations that fail validation are kept in
 * `sync_review`, never silently dropped (§24.4).
 */
export const SCHEMA_VERSION = 11;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL UNIQUE REFERENCES installations(id),
  account_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  opening_balance BIGINT NOT NULL,
  balance BIGINT NOT NULL,
  airtime_balance BIGINT NOT NULL DEFAULT 0,
  airtime_reset_total BIGINT NOT NULL DEFAULT 0,
  recharge_sender JSONB,
  version INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  operation_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  amount BIGINT NOT NULL,
  fee BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, operation_id),
  UNIQUE (account_id, sequence),
  UNIQUE (account_id, reference)
);

CREATE TABLE IF NOT EXISTS balance_movements (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  direction TEXT NOT NULL,
  amount BIGINT NOT NULL,
  balance_before BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  category TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS favourites (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  record JSONB NOT NULL,
  UNIQUE (account_id, type, key)
);

CREATE TABLE IF NOT EXISTS sync_operations (
  installation_id TEXT NOT NULL REFERENCES installations(id),
  operation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, operation_id, entity_type)
);

CREATE TABLE IF NOT EXISTS sync_review (
  id BIGSERIAL PRIMARY KEY,
  installation_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- v2: monetization foundation (§26–33)

-- Pricing rules (§27, §37.7). Each change is a new (id, version) row; old rows are kept for history.
CREATE TABLE IF NOT EXISTS pricing_rules (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  transaction_type TEXT,
  formula_type TEXT NOT NULL,
  free_threshold BIGINT NOT NULL,
  amount_per_token BIGINT,
  tier_configuration JSONB,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS pricing_meta (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version INTEGER NOT NULL
);

-- One central wallet per account (§28, §37.8). The caches are reconcilable from the ledger.
CREATE TABLE IF NOT EXISTS token_wallets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  total_balance_cache BIGINT NOT NULL DEFAULT 0,
  purchased_balance_cache BIGINT NOT NULL DEFAULT 0,
  promotional_balance_cache BIGINT NOT NULL DEFAULT 0,
  admin_balance_cache BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grant lots (§37.10): one per credit; a source reference can be credited only once.
CREATE TABLE IF NOT EXISTS token_lots (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES token_wallets(id),
  source_category TEXT NOT NULL,
  original_quantity BIGINT NOT NULL CHECK (original_quantity > 0),
  remaining_quantity BIGINT NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= original_quantity),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  source_reference TEXT NOT NULL,
  UNIQUE (wallet_id, source_reference)
);

-- Ledger (§28.1, §37.9): every movement, never edited or deleted.
CREATE TABLE IF NOT EXISTS token_ledger (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES token_wallets(id),
  entry_type TEXT NOT NULL,
  source_category TEXT NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  grant_lot_id TEXT NOT NULL REFERENCES token_lots(id),
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  metadata JSONB
);
-- Insertion order, for audits and statements (timestamps can tie).
ALTER TABLE token_ledger ADD COLUMN IF NOT EXISTS seq BIGSERIAL;
CREATE INDEX IF NOT EXISTS token_ledger_reference ON token_ledger (wallet_id, reference_type, reference_id);

-- One token spend per simulation (idempotency, §47.6): retries return the same spend.
CREATE TABLE IF NOT EXISTS token_spends (
  wallet_id TEXT NOT NULL REFERENCES token_wallets(id),
  simulation_id TEXT NOT NULL,
  quantity BIGINT NOT NULL,
  pricing JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SPENT', 'REVERSED')),
  created_at TIMESTAMPTZ NOT NULL,
  reversed_at TIMESTAMPTZ,
  PRIMARY KEY (wallet_id, simulation_id)
);

-- Back-office monetization settings (one row): payment switch, offline-free rule, token rate.
CREATE TABLE IF NOT EXISTS monetization_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Commercial payments (§30–33, §37.13), separate from simulated transactions.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  payment_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_reference TEXT,
  idempotency_key TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  tokens BIGINT,
  payer_phone TEXT,
  related_simulation_id TEXT,
  simulation_status TEXT NOT NULL,
  refund_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (provider, provider_reference)
);
CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  event TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Refundable payment credit (§33): owed to the user after a paid simulation failed.
CREATE TABLE IF NOT EXISTS payment_credits (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- v3: devices and token allocations (§29)

-- Installations are the devices (§37.11): installation-specific identity.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';

-- Tokens reserved inside a lot for a device allocation (central spending uses the unreserved part).
ALTER TABLE token_lots ADD COLUMN IF NOT EXISTS reserved_quantity BIGINT NOT NULL DEFAULT 0;

-- Device token allocations (§37.12): one ACTIVE allocation per device.
CREATE TABLE IF NOT EXISTS device_allocations (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES token_wallets(id),
  device_id TEXT NOT NULL REFERENCES installations(id),
  allocated_quantity BIGINT NOT NULL DEFAULT 0,
  spent_quantity BIGINT NOT NULL DEFAULT 0,
  released_quantity BIGINT NOT NULL DEFAULT 0,
  forfeited_quantity BIGINT NOT NULL DEFAULT 0,
  pricing JSONB NOT NULL,
  authorization_started_at TIMESTAMPTZ NOT NULL,
  authorization_expires_at TIMESTAMPTZ NOT NULL,
  last_renewed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'FORFEITED')),
  created_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS device_allocations_one_active ON device_allocations (device_id) WHERE status = 'ACTIVE';

-- Which lots an allocation reserved, and how much of each the device spent.
CREATE TABLE IF NOT EXISTS allocation_lots (
  allocation_id TEXT NOT NULL REFERENCES device_allocations(id),
  lot_id TEXT NOT NULL REFERENCES token_lots(id),
  category TEXT NOT NULL,
  quantity BIGINT NOT NULL,
  spent BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (allocation_id, lot_id)
);

ALTER TABLE token_spends ADD COLUMN IF NOT EXISTS allocation_id TEXT;

-- ---------------------------------------------------------------- v4: admin back office (§34–35, §44.3)

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'VIEWER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Sessions: only the SHA-256 of the cookie token is stored; each carries its own CSRF token.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  csrf TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Review items resolved by an operator (the original stays for audit).
ALTER TABLE sync_review ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE sync_review ADD COLUMN IF NOT EXISTS resolved_by TEXT;

-- ---------------------------------------------------------------- v5: 2-step sign-in for admins, account sign-in by email

-- Authenticator-app (TOTP) 2-step sign-in. Recovery codes are stored as SHA-256 hashes; used ones are removed.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS recovery_codes JSONB NOT NULL DEFAULT '[]';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
-- Password accepted, waiting for the authenticator code (5 minutes, 5 tries).
CREATE TABLE IF NOT EXISTS admin_pending_logins (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL
);

-- People who sign in to the app with their email. One account per person; one active device per account.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sign_in_at TIMESTAMPTZ
);
-- One-time sign-in codes: only a salted hash is kept; 10 minutes, 5 tries.
CREATE TABLE IF NOT EXISTS sign_in_codes (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sign_in_codes_email ON sign_in_codes (email, created_at);
CREATE INDEX IF NOT EXISTS sign_in_codes_installation ON sign_in_codes (installation_id, created_at);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id TEXT UNIQUE REFERENCES users(id);
-- The account a device works on. accounts.installation_id is the ACTIVE device; a device signed out by a
-- sign-in elsewhere keeps account_id so it can still upload what it recorded before (then it wipes itself).
ALTER TABLE installations ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(id);
ALTER TABLE installations ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
ALTER TABLE installations ADD COLUMN IF NOT EXISTS signed_in_at TIMESTAMPTZ;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS signed_out_at TIMESTAMPTZ;
-- An account dropped by its device (the person chose another account there) has no active device.
ALTER TABLE accounts ALTER COLUMN installation_id DROP NOT NULL;
UPDATE installations i SET account_id = a.id FROM accounts a WHERE a.installation_id = i.id AND i.account_id IS NULL;

-- ---------------------------------------------------------------- v6: settings history, review actions

-- Every version of the monetization settings, so an upload is judged by the settings in force when the
-- simulation happened (offline devices upload later). Seeded once from the audit log.
CREATE TABLE IF NOT EXISTS monetization_settings_history (
  id BIGSERIAL PRIMARY KEY,
  effective_from TIMESTAMPTZ NOT NULL,
  settings JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS monetization_settings_history_from ON monetization_settings_history (effective_from);
INSERT INTO monetization_settings_history (effective_from, settings)
SELECT created_at, after_value FROM audit_log
WHERE action = 'UPDATE_MONETIZATION_SETTINGS' AND after_value IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM monetization_settings_history);

-- What a reviewer did: APPLIED (stored after all) or DISMISSED (kept out of the ledger).
ALTER TABLE sync_review ADD COLUMN IF NOT EXISTS action TEXT;

-- ---------------------------------------------------------------- v7: reversible suspensions

-- A suspended device or account is refused by the server until reinstated (nothing is deleted).
ALTER TABLE installations ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS suspended_by TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS suspended_by TEXT;

-- ---------------------------------------------------------------- v8: paced payment status checks

-- send_started_at: a prompt is being sent (a concurrent retry must not send a second one).
-- next_check_at / check_failures: when the provider may next be asked about this payment (providers
-- rate-limit status checks; failures back off).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS send_started_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_failures INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------- v9: editable fee schedules

-- Every version of each simulated M-PESA fee schedule (seeded from the built-in ones; old versions kept so
-- uploads made with them can still be checked).
CREATE TABLE IF NOT EXISTS fee_schedules (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  bands JSONB NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

-- ---------------------------------------------------------------- v10: transaction and payment method controls
-- Control which transaction types are available and which payment methods (tokens vs pay-per-simulation).
-- transaction_type_controls: map of SimulationType -> boolean (enabled/disabled)
-- payment_method_controls: { tokensEnabled: boolean, directPayEnabled: boolean }
-- active_payment_provider: which provider to use for payments (mpesa-daraja, payhero, etc.)
ALTER TABLE monetization_settings ADD COLUMN IF NOT EXISTS transaction_type_controls JSONB NOT NULL DEFAULT '{}';
ALTER TABLE monetization_settings ADD COLUMN IF NOT EXISTS payment_method_controls JSONB NOT NULL DEFAULT '{"tokensEnabled":true,"directPayEnabled":true}';
ALTER TABLE monetization_settings ADD COLUMN IF NOT EXISTS active_payment_provider TEXT;
-- Admin session timeout reduced from 8h to 2h (max 2 hours, owner decision)
-- Existing sessions exceeding 2h will naturally expire
-- NOTE: the three columns above are not used: these settings live in monetization_settings.settings (JSON)
-- with every other monetization setting, so they are versioned in monetization_settings_history too.

-- ---------------------------------------------------------------- v11: account deletion, terms acceptance
-- A deleted account keeps an anonymous row ("tombstone") so retained payment records still point somewhere;
-- everything personal around it is erased (see account-deletion.service.ts).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- One-time codes have a purpose: a sign-in code can never confirm a deletion, or the reverse.
ALTER TABLE sign_in_codes ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'SIGN_IN';
-- Which version of the Privacy Policy / Terms the person accepted, and when (proof of consent, DPA s.32).
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
`;
