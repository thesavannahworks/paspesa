/**
 * Server schema (White Paper §37). The server keeps the authoritative ledger: balances are derived
 * from validated transactions, never taken from the client (§39.1). Idempotency is enforced by
 * primary keys and UNIQUE constraints (§25). Operations that fail validation are kept in
 * `sync_review`, never silently dropped (§24.4).
 */
export const SCHEMA_VERSION = 1;

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
`;
