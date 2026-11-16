import { getDatabase } from './db.native';
import type { KeyValueStore } from './kvTypes';

/** Android/iOS: table `kv` in the SQLite file `paspesa.db`. */
export async function openKeyValueStore(): Promise<KeyValueStore> {
  const db = await getDatabase();
  await db.execAsync('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');
  return {
    async get(key) {
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
      return row?.value ?? null;
    },
    async set(key, value) {
      await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
    },
    async remove(key) {
      await db.runAsync('DELETE FROM kv WHERE key = ?', key);
    },
  };
}
