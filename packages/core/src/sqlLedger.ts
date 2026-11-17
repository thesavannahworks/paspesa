/**
 * SQL persistence for the local ledger (White Paper §7: SQLite on Android/iOS; §23.2 local persistence).
 * Platform-neutral: the app supplies an executor (expo-sqlite on the phone; node:sqlite in tests).
 *
 * Each entity has its own table. Columns used for lookups and integrity are real columns with UNIQUE
 * constraints (operation ID, reference, sequence — duplicate protection at the database level, §25);
 * the full record is kept as JSON in `data` so new optional fields need no migration.
 */
import { stateToChangeSet, type ChangeSet } from './changes';
import { normalizeState, type MemoryState } from './memoryStore';

export const SQL_SCHEMA_VERSION = 1;

/** The few calls the ledger needs. `transaction` must run `work` as ONE all-or-nothing transaction. */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params: (string | number | null)[]): Promise<void>;
  all<T>(sql: string, params?: (string | number | null)[]): Promise<T[]>;
  transaction(work: (tx: Omit<SqlExecutor, 'transaction'>) => Promise<void>): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger_account (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  reference TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL UNIQUE,
  type TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_movements (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (transaction_id, movement_type)
);
CREATE TABLE IF NOT EXISTS ledger_messages (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_messages_tx ON ledger_messages (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ledger_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (operation_id, entity_type)
);
CREATE TABLE IF NOT EXISTS ledger_favourites (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);
`;

/** Creates the tables (idempotent) and records the schema version. */
export async function migrateSqlLedger(db: SqlExecutor): Promise<void> {
  await db.exec(SCHEMA);
  await db.run('INSERT OR IGNORE INTO ledger_meta (key, value) VALUES (?, ?)', ['schemaVersion', String(SQL_SCHEMA_VERSION)]);
}

const parse = <T>(rows: { data: string }[]): T[] => rows.map((r) => JSON.parse(r.data) as T);

/** Loads the whole local ledger. Returns null when the tables hold nothing yet. */
export async function loadSqlLedger(db: SqlExecutor): Promise<MemoryState | null> {
  const [account] = parse<MemoryState['account']>(await db.all('SELECT data FROM ledger_account'));
  const state = normalizeState({
    account: account ?? null,
    transactions: parse(await db.all('SELECT data FROM ledger_transactions ORDER BY sequence')),
    movements: parse(await db.all('SELECT data FROM ledger_movements ORDER BY created_at')),
    messages: parse(await db.all('SELECT data FROM ledger_messages ORDER BY created_at')),
    outbox: parse(await db.all('SELECT data FROM ledger_outbox ORDER BY created_at')),
    favourites: parse(await db.all('SELECT data FROM ledger_favourites')),
  });
  const empty = !state.account && !state.transactions.length && !state.messages.length && !state.favourites.length;
  return empty ? null : state;
}

/** Writes one unit's changes in a single transaction (all rows or none). */
export async function applySqlChanges(db: SqlExecutor, c: ChangeSet): Promise<void> {
  await db.transaction((tx) => writeChanges(tx, c));
}

const LEDGER_TABLES = ['ledger_account', 'ledger_transactions', 'ledger_movements', 'ledger_messages', 'ledger_outbox', 'ledger_favourites'];

/** Replaces the whole ledger in one transaction (sign-out wipe, or an account restored from the server). */
export async function replaceSqlLedger(db: SqlExecutor, state: MemoryState): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of LEDGER_TABLES) await tx.run(`DELETE FROM ${table}`, []);
    await writeChanges(tx, stateToChangeSet(state));
  });
}

async function writeChanges(tx: Omit<SqlExecutor, 'transaction'>, c: ChangeSet): Promise<void> {
  {
    if (c.account) {
      await tx.run('INSERT OR REPLACE INTO ledger_account (id, data) VALUES (?, ?)', [c.account.id, JSON.stringify(c.account)]);
    }
    for (const t of c.transactions) {
      await tx.run(
        `INSERT INTO ledger_transactions (id, operation_id, reference, sequence, type, completed_at, sync_status, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET sync_status = excluded.sync_status, data = excluded.data`,
        [t.id, t.operationId, t.reference, t.sequence, t.type, t.completedAt, t.syncStatus, JSON.stringify(t)],
      );
    }
    for (const m of c.movements) {
      await tx.run(
        'INSERT OR REPLACE INTO ledger_movements (id, transaction_id, movement_type, created_at, data) VALUES (?, ?, ?, ?, ?)',
        [m.id, m.transactionId, m.movementType, m.createdAt, JSON.stringify(m)],
      );
    }
    for (const m of c.messages) {
      await tx.run(
        `INSERT INTO ledger_messages (id, transaction_id, created_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [m.id, m.transactionId, m.createdAt, JSON.stringify(m)],
      );
    }
    for (const e of c.outbox) {
      await tx.run(
        `INSERT INTO ledger_outbox (id, operation_id, entity_type, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
        [e.id, e.operationId, e.entityType, e.status, e.createdAt, JSON.stringify(e)],
      );
    }
    if (c.favourites) {
      await tx.run('DELETE FROM ledger_favourites', []);
      for (const f of c.favourites) await tx.run('INSERT INTO ledger_favourites (id, data) VALUES (?, ?)', [f.id, JSON.stringify(f)]);
    }
  }
}

