/**
 * The app's single IndexedDB database (`paspesa`).
 * v1: `kv` (preferences, installation id, and the old single-record ledger).
 * v2: ledger object stores, one per entity (White Paper §7: IndexedDB on the web), with unique
 *     indexes for duplicate protection (§25).
 */
export const LEDGER_STORES = ['ledger_account', 'ledger_transactions', 'ledger_movements', 'ledger_messages', 'ledger_outbox', 'ledger_favourites'] as const;

let opening: Promise<IDBDatabase> | null = null;

export function getIndexedDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('paspesa', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      for (const name of LEDGER_STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name === 'ledger_transactions') {
          store.createIndex('operationId', 'operationId', { unique: true });
          store.createIndex('reference', 'reference', { unique: true });
          store.createIndex('sequence', 'sequence', { unique: true });
        }
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
  return opening;
}

/** Runs one transaction and resolves once it has committed; rejects if it aborts (nothing is kept). */
export async function idbTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await getIndexedDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let request: IDBRequest<T> | void;
    try {
      request = work(tx);
    } catch (e) {
      tx.abort();
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
