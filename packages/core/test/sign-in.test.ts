/// <reference types="node" />
/**
 * Restoring an account onto a new device (sign-in), and replacing / wiping the local ledger.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  addFavourite,
  isValidEmail,
  loadSqlLedger,
  migrateSqlLedger,
  normalizeEmail,
  replaceSqlLedger,
  setPin,
  stateFromSnapshot,
  type AccountSnapshot,
  type MemoryState,
  type SqlExecutor,
} from '../src';
import { TEST_PIN, makeAccount, makeDeps, newOp, processSimulation, sequentialIds } from './helpers';

function nodeExecutor(db: DatabaseSync): SqlExecutor {
  const base = {
    async exec(sql: string) { db.exec(sql); },
    async run(sql: string, params: (string | number | null)[]) { db.prepare(sql).run(...params); },
    async all<T>(sql: string, params: (string | number | null)[] = []) { return db.prepare(sql).all(...params) as T[]; },
  };
  return {
    ...base,
    async transaction(work) {
      db.exec('BEGIN');
      try {
        await work(base);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** What the server would send for this device's ledger (it never sends the PIN or local flags). */
function snapshotOf(state: MemoryState): AccountSnapshot {
  const a = state.account!;
  return {
    account: {
      id: a.id, installationId: a.installationId, accountName: a.accountName, phoneNumber: a.phoneNumber, openingBalance: a.openingBalance,
      currency: a.currency, createdAt: a.createdAt, updatedAt: a.updatedAt, balance: a.currentBalanceCache, airtimeBalance: a.airtimeBalance,
      airtimeResetTotal: a.airtimeResetTotal, rechargeSenderDefaults: a.rechargeSenderDefaults, version: a.version,
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    transactions: [...state.transactions].reverse().map(({ syncStatus, ...t }) => t),
    messages: state.messages.filter((m) => m.transactionId).map((m) => ({
      id: m.id, transactionId: m.transactionId, category: m.category, templateId: m.templateId, templateVersion: m.templateVersion, body: m.body, createdAt: m.createdAt,
    })),
    favourites: state.favourites,
  };
}

describe('email', () => {
  it('normalizes and validates', () => {
    expect(normalizeEmail('  Wanjiku@Example.COM ')).toBe('wanjiku@example.com');
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('two@@signs.com')).toBe(false);
  });
});

describe('restoring an account onto a new device', () => {
  it('rebuilds the same balance, history and messages; the new device sets its own PIN', async () => {
    const { deps } = await makeAccount(10_000);
    await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 400, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, pin: TEST_PIN });
    await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 50, counterparty: {}, pin: TEST_PIN });
    await addFavourite(deps, { type: 'BUY_GOODS', counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
    const original = (deps.store as MemoryStore).snapshot();

    const state = stateFromSnapshot(snapshotOf(original), 'new-device');
    expect(state.account).toMatchObject({ installationId: 'new-device', currentBalanceCache: original.account!.currentBalanceCache, airtimeBalance: 50, pin: null, tokenAllocation: null });
    expect(state.transactions.map((t) => t.sequence)).toEqual([1, 2, 3]);
    expect(state.transactions.every((t) => t.syncStatus === 'SYNCED')).toBe(true);
    expect(state.movements).toHaveLength(3);
    expect(state.messages.every((m) => m.readAt)).toBe(true);
    expect(state.favourites).toHaveLength(1);
    expect(state.outbox).toEqual([]);

    // the restored device continues the numbering once it has a PIN
    const store = new MemoryStore(state);
    const { deps: restored } = makeDeps({ store, installationId: 'new-device', ids: sequentialIds('restored') });
    expect((await processSimulation(restored, { operationId: newOp(), type: 'SEND_MONEY', amount: 100, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, pin: TEST_PIN })).ok).toBe(false);
    expect((await setPin(restored, { newPin: TEST_PIN })).ok).toBe(true);
    const next = await processSimulation(restored, { operationId: newOp(), type: 'SEND_MONEY', amount: 100, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, pin: TEST_PIN });
    if (!next.ok) throw new Error(next.error.code + ': ' + next.error.message);
    expect(next.transaction.sequence).toBe(4);
  });

  it('refuses a snapshot whose transactions do not add up to the balance', async () => {
    const { deps } = await makeAccount(10_000);
    const snap = snapshotOf((deps.store as MemoryStore).snapshot());
    snap.account.balance += 1;
    expect(() => stateFromSnapshot(snap, 'x')).toThrow(/add up/);
  });
});

describe('replacing the local ledger', () => {
  it('replaceState swaps everything at once, and replaceSqlLedger mirrors it in the tables', async () => {
    const db = nodeExecutor(new DatabaseSync(':memory:'));
    await migrateSqlLedger(db);
    const { deps } = await makeAccount(5_000);
    const store = deps.store as MemoryStore;
    await replaceSqlLedger(db, store.snapshot());
    expect((await loadSqlLedger(db))!.account!.openingBalance).toBe(5_000);

    // sign-out wipe
    await store.replaceState({ account: null, transactions: [], movements: [], messages: [], outbox: [], favourites: [] }, (s) => replaceSqlLedger(db, s));
    expect(await store.getAccount()).toBeNull();
    expect(await loadSqlLedger(db)).toBeNull();

    // a failed write leaves the visible state unchanged
    const { deps: other } = await makeAccount(7_000);
    await expect(store.replaceState((other.store as MemoryStore).snapshot(), async () => { throw new Error('disk full'); })).rejects.toThrow('disk full');
    expect(await store.getAccount()).toBeNull();
  });
});
