import * as SQLite from 'expo-sqlite';

let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/** The app's single SQLite database file (`paspesa.db`): preferences (kv) and ledger tables. */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  opening ??= SQLite.openDatabaseAsync('paspesa.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode = WAL;');
    return db;
  });
  return opening;
}
