import { idbTransaction } from './idb.web';
import type { KeyValueStore } from './kvTypes';

/** Web/PWA: object store `kv` in the IndexedDB database `paspesa`. Each call is one committed transaction. */
export async function openKeyValueStore(): Promise<KeyValueStore> {
  return {
    get: async (key) => ((await idbTransaction<string | undefined>(['kv'], 'readonly', (tx) => tx.objectStore('kv').get(key))) ?? null),
    set: async (key, value) => {
      await idbTransaction(['kv'], 'readwrite', (tx) => {
        tx.objectStore('kv').put(value, key);
      });
    },
    remove: async (key) => {
      await idbTransaction(['kv'], 'readwrite', (tx) => {
        tx.objectStore('kv').delete(key);
      });
    },
  };
}
