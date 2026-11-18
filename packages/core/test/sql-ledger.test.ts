/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  addFavourite,
  applySqlChanges,
  deleteMessages,
  loadSqlLedger,
  markAllMessagesRead,
  migrateSqlLedger,
  removeFavourite,
  setMessageStarred,
  setupAccount,
  stateToChangeSet,
  type ChangeSet,
  type MemoryState,
  type SqlExecutor,
} from '../src';
import { TEST_PIN, makeDeps, newOp, processSimulation } from './helpers';

/** SqlExecutor over node:sqlite (the phone uses the same interface over expo-sqlite). */
function nodeExecutor(db: DatabaseSync, failOnStatement?: { n: number }): SqlExecutor {
  let statements = 0;
  const base = {
    async exec(sql: string) { db.exec(sql); },
    async run(sql: string, params: (string | number | null)[]) {
      if (failOnStatement && ++statements === failOnStatement.n) throw new Error('disk full');
      db.prepare(sql).run(...params);
    },
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

const sortById = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const normalized = (s: MemoryState) => ({
  account: s.account,
  transactions: sortById(s.transactions),
  movements: sortById(s.movements),
  messages: sortById(s.messages),
  outbox: sortById(s.outbox),
  favourites: sortById(s.favourites),
});

async function sqlBackedStore(db: SqlExecutor, initial?: MemoryState) {
  await migrateSqlLedger(db);
  const units: ChangeSet[] = [];
  const store = new MemoryStore(initial, { persistChanges: async (c) => { units.push(c); await applySqlChanges(db, c); } });
  return { store, units };
}

async function exerciseEverything(store: MemoryStore) {
  const { deps } = makeDeps({ store });
  const setup = await setupAccount(deps, { operationId: 'op-setup', accountName: 'Amina Wanjiru', phoneNumber: '0798765432', openingBalance: 20_000, pin: TEST_PIN });
  if (!setup.ok) throw new Error(setup.error.message);
  await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 400, counterparty: { phone: '0722000111', name: 'Peter Kamau' } });
  await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 90, counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
  await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 1_000, counterparty: {} });
  await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 50, counterparty: {} });
  await processSimulation(deps, { operationId: newOp(), type: 'PAYBILL', amount: 130, counterparty: { paybillNumber: '400200', businessName: 'Lipakitu', accountReference: '1780' } });
  await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 10, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, pin: '9999' }); // wrong PIN notice
  const fav = await addFavourite(deps, { type: 'BUY_GOODS', counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
  await addFavourite(deps, { type: 'SEND_MONEY', counterparty: { phone: '0180354207', name: "Rachael Ndung'u" } });
  if (fav.ok) await removeFavourite(deps, fav.favourite.id);
  await markAllMessagesRead(deps);
  const messages = await store.listMessages();
  await setMessageStarred(deps, messages[0]!.id, true);
  await deleteMessages(deps, [messages[1]!.id, messages[2]!.id]);
  return deps;
}

describe('SQL ledger tables (SQLite)', () => {
  it('the tables always hold exactly the in-memory ledger, row for row', async () => {
    const db = nodeExecutor(new DatabaseSync(':memory:'));
    const { store } = await sqlBackedStore(db);
    await exerciseEverything(store);
    const loaded = await loadSqlLedger(db);
    expect(normalized(loaded!)).toEqual(normalized(store.snapshot()));
  });

  it('only changed rows are written, and nothing for units that change nothing', async () => {
    const db = nodeExecutor(new DatabaseSync(':memory:'));
    const { store, units } = await sqlBackedStore(db);
    const deps = await exerciseEverything(store);
    const before = units.length;
    await markAllMessagesRead(deps); // nothing unread any more
    expect(units.length).toBe(before);
    await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 5, counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
    const last = units.at(-1)!;
    expect([last.transactions.length, last.movements.length, last.messages.length, last.outbox.length]).toEqual([1, 1, 1, 1]);
    expect(last.account).toBeDefined();
    expect(last.favourites).toBeUndefined();
  });

  it('survives a restart: reload from the tables and keep transacting', async () => {
    const raw = new DatabaseSync(':memory:');
    const first = await sqlBackedStore(nodeExecutor(raw));
    await exerciseEverything(first.store);
    const reloaded = (await loadSqlLedger(nodeExecutor(raw)))!;
    const second = await sqlBackedStore(nodeExecutor(raw), reloaded);
    const { deps } = makeDeps({ store: second.store });
    const r = await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 20, counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
    expect(r.ok).toBe(true);
    expect(normalized((await loadSqlLedger(nodeExecutor(raw)))!)).toEqual(normalized(second.store.snapshot()));
  });

  it('a failed write rolls back every row of the unit and the app state stays as it was', async () => {
    const raw = new DatabaseSync(':memory:');
    const ok = await sqlBackedStore(nodeExecutor(raw));
    await exerciseEverything(ok.store);
    const snapshotBefore = ok.store.snapshot();
    const tablesBefore = await loadSqlLedger(nodeExecutor(raw));

    const failing = nodeExecutor(raw, { n: 3 }); // fails on the 3rd row of the next unit
    const store = new MemoryStore(snapshotBefore, { persistChanges: (c) => applySqlChanges(failing, c) });
    const { deps } = makeDeps({ store });
    const r = await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 20, counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
    expect(!r.ok && r.error.code).toBe('STORAGE_FAILURE');
    expect(normalized(store.snapshot())).toEqual(normalized(snapshotBefore));
    expect(normalized((await loadSqlLedger(nodeExecutor(raw)))!)).toEqual(normalized(tablesBefore!));
  });

  it('the database itself rejects a second transaction with the same operation ID or reference', async () => {
    const raw = new DatabaseSync(':memory:');
    const db = nodeExecutor(raw);
    const { store } = await sqlBackedStore(db);
    await exerciseEverything(store);
    const [tx] = await store.listTransactions();
    await expect(applySqlChanges(db, { transactions: [{ ...tx!, id: 'other-id', sequence: 999, reference: 'UKXLA00000' }], movements: [], messages: [], outbox: [] })).rejects.toThrow(/UNIQUE/);
    await expect(applySqlChanges(db, { transactions: [{ ...tx!, id: 'other-id', sequence: 999, operationId: 'op-x' }], movements: [], messages: [], outbox: [] })).rejects.toThrow(/UNIQUE/);
  });

  it('migrates a whole saved state (the old single-record format) in one go', async () => {
    const legacy = new MemoryStore();
    await exerciseEverything(legacy);
    const db = nodeExecutor(new DatabaseSync(':memory:'));
    await migrateSqlLedger(db);
    expect(await loadSqlLedger(db)).toBeNull();
    await applySqlChanges(db, stateToChangeSet(legacy.snapshot()));
    expect(normalized((await loadSqlLedger(db))!)).toEqual(normalized(legacy.snapshot()));
    await migrateSqlLedger(db); // idempotent on restart
  });
});
