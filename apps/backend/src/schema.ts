/**
 * Server schema (White Paper §37). The server keeps the authoritative ledger: balances are derived
 * from validated transactions, never taken from the client (§39.1). Idempotency is enforced by
 * primary keys and UNIQUE constraints (§25). Operations that fail validation are kept in
 * `sync_review`, never silently dropped (§24.4).
 */
export const SCHEMA_VERSION = 2;

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
`;
