import type { KeyValueStore } from './kvTypes';

/** Web/PWA: IndexedDB database `paspesa`, object store `kv`. */
export function openKeyValueStore(): Promise<KeyValueStore> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('paspesa', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const run = <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
        new Promise((res, rej) => {
          const tx = db.transaction('kv', mode);
          const r = op(tx.objectStore('kv'));
          // Resolve on transaction completion so writes are durable before we continue.
          tx.oncomplete = () => res(r.result as T);
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
      resolve({
        get: async (key) => ((await run<string | undefined>('readonly', (s) => s.get(key))) ?? null),
        set: async (key, value) => { await run('readwrite', (s) => s.put(value, key)); },
        remove: async (key) => { await run('readwrite', (s) => s.delete(key)); },
      });
    };
  });
}
