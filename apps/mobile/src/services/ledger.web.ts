/** Web/PWA ledger: one IndexedDB object store per entity; each unit is one IndexedDB transaction. */
import { normalizeState, stateToChangeSet, type ChangeSet, type MemoryState } from '@paspesa/core';
import { LEDGER_STORES, getIndexedDb, idbTransaction } from './idb.web';
import type { LedgerPersistence } from './ledgerTypes';

function getAll<T>(tx: IDBTransaction, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror = () => reject(r.error);
  });
}

async function load(): Promise<MemoryState | null> {
  const db = await getIndexedDb();
  const tx = db.transaction([...LEDGER_STORES], 'readonly');
  const [accounts, transactions, movements, messages, outbox, favourites] = await Promise.all([
    getAll<NonNullable<MemoryState['account']>>(tx, 'ledger_account'),
    getAll<MemoryState['transactions'][number]>(tx, 'ledger_transactions'),
    getAll<MemoryState['movements'][number]>(tx, 'ledger_movements'),
    getAll<MemoryState['messages'][number]>(tx, 'ledger_messages'),
    getAll<MemoryState['outbox'][number]>(tx, 'ledger_outbox'),
    getAll<MemoryState['favourites'][number]>(tx, 'ledger_favourites'),
  ]);
  const state = normalizeState({
    account: accounts[0] ?? null,
    transactions: transactions.sort((a, b) => a.sequence - b.sequence),
    movements,
    messages,
    outbox,
    favourites,
  });
  const empty = !state.account && !state.transactions.length && !state.messages.length && !state.favourites.length;
  return empty ? null : state;
}

function write(tx: IDBTransaction, c: ChangeSet) {
    if (c.account) tx.objectStore('ledger_account').put(c.account);
    for (const t of c.transactions) tx.objectStore('ledger_transactions').put(t);
    for (const m of c.movements) tx.objectStore('ledger_movements').put(m);
    for (const m of c.messages) tx.objectStore('ledger_messages').put(m);
    for (const e of c.outbox) tx.objectStore('ledger_outbox').put(e);
    if (c.favourites) {
      const favs = tx.objectStore('ledger_favourites');
      favs.clear();
      for (const f of c.favourites) favs.put(f);
    }
}

async function apply(c: ChangeSet): Promise<void> {
  await idbTransaction([...LEDGER_STORES], 'readwrite', (tx) => write(tx, c));
}

/** Replaces everything in one IndexedDB transaction (sign-out wipe, or a restored account). */
async function replace(state: MemoryState): Promise<void> {
  await idbTransaction([...LEDGER_STORES], 'readwrite', (tx) => {
    for (const store of LEDGER_STORES) tx.objectStore(store).clear();
    write(tx, stateToChangeSet(state));
  });
}

export async function openLedgerPersistence(): Promise<LedgerPersistence> {
  await getIndexedDb();
  return { load, apply, replace };
}
