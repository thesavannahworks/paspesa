/** Android/iOS ledger tables in SQLite (`paspesa.db`), via the shared SQL layer in @paspesa/core. */
import { applySqlChanges, loadSqlLedger, migrateSqlLedger, replaceSqlLedger, type SqlExecutor } from '@paspesa/core';
import type { SQLiteBindValue } from 'expo-sqlite';
import { getDatabase } from './db.native';
import type { LedgerPersistence } from './ledgerTypes';

interface Queryable {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SQLiteBindValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: SQLiteBindValue[]): Promise<T[]>;
}

const statements = (q: Queryable): Omit<SqlExecutor, 'transaction'> => ({
  exec: (sql) => q.execAsync(sql),
  run: async (sql, params) => { await q.runAsync(sql, params); },
  all: (sql, params = []) => q.getAllAsync(sql, params),
});

export async function openLedgerPersistence(): Promise<LedgerPersistence> {
  const db = await getDatabase();
  const executor: SqlExecutor = {
    ...statements(db),
    // Exclusive: only this unit's statements are inside the transaction (a preference saved at the same
    // moment cannot be swept into it), and it commits or rolls back as a whole.
    transaction: (work) => db.withExclusiveTransactionAsync(async (txn) => work(statements(txn))),
  };
  await migrateSqlLedger(executor);
  return { load: () => loadSqlLedger(executor), apply: (changes) => applySqlChanges(executor, changes), replace: (state) => replaceSqlLedger(executor, state) };
}
