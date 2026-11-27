/**
 * End to end: the real engine and sync client (from @paspesa/core) talk HTTP to the real Nest app,
 * backed by an in-memory PostgreSQL (PGlite). Covers White Paper §47.7 (offline and sync) and §47.6
 * (idempotency): sync, retry safety, server-side validation, review handling, auth.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MemoryStore,
  addFavourite,
  processSimulation,
  removeFavourite,
  resetAirtimeBalance,
  setupAccount,
  syncOutbox,
  updateAccountDetails,
  updateRechargeSenderDefaults,
  type EngineDeps,
  type MemoryState,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncTransport,
} from '@paspesa/core';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';

let db: Database;
let app: Awaited<ReturnType<typeof createApp>>;
let baseUrl: string;

beforeAll(async () => {
  db = await openDatabase({});
  app = await createApp(db);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

const PIN = '1234';

function makeDeps(store = new MemoryStore()): EngineDeps {
  let t = Date.parse('2026-11-17T06:00:00.000Z');
  return {
    store,
    config: DEFAULT_CONFIG,
    clock: { now: () => new Date((t += 60_000)).toISOString() },
    ids: { uuid: () => randomUUID() },
    random: { int: (max) => Math.floor(Math.random() * max) },
    pinHasher: { hash: async (pin, salt) => `h(${salt}:${pin})` },
    installationId: randomUUID(),
  };
}

async function register(installationId: string) {
  const token = randomBytes(32).toString('base64url');
  const res = await fetch(`${baseUrl}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId, token }) });
  expect(res.status).toBe(200);
  return token;
}

function http(token: string): SyncTransport {
  return {
    async push(request: SyncPushRequest) {
      const res = await fetch(`${baseUrl}/v1/sync/push`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(request) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as SyncPushResponse;
    },
  };
}

// Response bodies are checked field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const get = async (path: string, token: string): Promise<{ status: number; body: Json }> => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as Json };
};

async function newAccount(opening = 10_000) {
  const deps = makeDeps();
  const res = await setupAccount(deps, { operationId: randomUUID(), accountName: 'Amina Wanjiru', phoneNumber: '0798765432', openingBalance: opening, pin: PIN });
  if (!res.ok) throw new Error(res.error.message);
  const token = await register(deps.installationId);
  return { deps, token };
}

const pay = (deps: EngineDeps, req: Parameters<typeof processSimulation>[1] extends infer R ? Omit<R & object, 'operationId' | 'pin'> : never) =>
  processSimulation(deps, { ...(req as object), operationId: randomUUID(), pin: PIN } as Parameters<typeof processSimulation>[1]);

describe('synchronization', () => {
  it('uploads everything; the server ledger matches the phone exactly', async () => {
    const { deps, token } = await newAccount(20_000);
    await pay(deps, { type: 'SEND_MONEY', amount: 400, counterparty: { phone: '0722000111', name: 'Peter Kamau' } });
    await pay(deps, { type: 'SEND_MONEY', amount: 1_000, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, addWithdrawalCharge: true });
    await pay(deps, { type: 'BUY_GOODS', amount: 90, counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
    await pay(deps, { type: 'PAYBILL', amount: 130, counterparty: { paybillNumber: '400200', businessName: 'Lipakitu', accountReference: '1780' } });
    await pay(deps, { type: 'AIRTIME', variant: 'OWN', amount: 50, counterparty: {} });
    await pay(deps, { type: 'RECHARGE', amount: 700, counterparty: { name: 'Kevin Ouma', phone: '0745123456' } });
    await processSimulation(deps, { operationId: randomUUID(), type: 'BUY_GOODS', amount: 5, counterparty: { tillNumber: '453851' }, pin: '9999' }); // wrong PIN: nothing to sync
    await resetAirtimeBalance(deps);
    await updateAccountDetails(deps, { accountName: 'Brian Otieno', phoneNumber: '0111000222' });
    await updateRechargeSenderDefaults(deps, { name: 'Grace Akinyi', phone: '0700111222' });
    const fav = await addFavourite(deps, { type: 'BUY_GOODS', counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
    await addFavourite(deps, { type: 'SEND_MONEY', counterparty: { phone: '0180354207', name: "Rachael Ndung'u" } });
    if (fav.ok) await removeFavourite(deps, fav.favourite.id);

    const report = await syncOutbox(deps, http(token));
    expect(report.error).toBeNull();
    expect(report.needsReview).toBe(0);

    const account = (await deps.store.getAccount())!;
    expect(report.server).toEqual({ balance: account.currentBalanceCache, version: account.version, airtimeBalance: 0 });
    const local = await deps.store.listTransactions();
    expect(local.every((t) => t.syncStatus === 'SYNCED')).toBe(true);
    expect((await deps.store.listOutbox()).every((e) => e.status === 'DONE')).toBe(true);

    const pulled = await get('/v1/sync/pull?afterSequence=0', token);
    expect(pulled.body.transactions.map((t: { id: string }) => t.id).sort()).toEqual(local.map((t) => t.id).sort());
    expect(pulled.body.account).toMatchObject({ accountName: 'Brian Otieno', phoneNumber: '254111000222', balance: account.currentBalanceCache });
    const favs = await db.query<{ type: string }>('SELECT f.type FROM favourites f JOIN accounts a ON a.id = f.account_id WHERE a.installation_id = $1', [deps.installationId]);
    expect(favs.map((f) => f.type)).toEqual(['SEND_MONEY']);
    const msgs = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM messages m JOIN accounts a ON a.id = m.account_id WHERE a.installation_id = $1', [deps.installationId]);
    expect(msgs[0]!.n).toBe(6); // one confirmation per payment; the wrong-PIN notice stays on the phone
    const audit = await db.query<{ action: string }>("SELECT action FROM audit_log WHERE actor_id = $1 ORDER BY id", [`installation:${deps.installationId}`]);
    expect(audit.map((a) => a.action)).toEqual(['RESET_AIRTIME_BALANCE', 'UPDATE_ACCOUNT_DETAILS', 'UPDATE_RECHARGE_SENDER']);

    // nothing left: a second sync sends nothing
    expect((await syncOutbox(deps, http(token))).uploaded).toBe(0);
  });

  it('is safe to retry: a lost response does not create anything twice', async () => {
    const { deps, token } = await newAccount();
    await pay(deps, { type: 'BUY_GOODS', amount: 100, counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
    const real = http(token);
    // the server processes the upload but the phone never hears back (network drop)
    const lossy: SyncTransport = { push: async (r) => { await real.push(r); throw new Error('network timeout'); } };
    const first = await syncOutbox(deps, lossy);
    expect(first.error).toBe('network timeout');
    expect((await deps.store.listOutbox()).every((e) => e.status === 'FAILED')).toBe(true);

    const second = await syncOutbox(deps, real);
    expect(second.error).toBeNull();
    expect(second.synced).toBe(2);
    const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.installation_id = $1', [deps.installationId]);
    expect(n[0]!.n).toBe(2); // opening balance + one payment, not four
    expect(second.server!.balance).toBe(9_900);
  });

  it('works offline: nothing is lost while the server is unreachable', async () => {
    const { deps, token } = await newAccount();
    const down: SyncTransport = { push: async () => { throw new Error('fetch failed'); } };
    await pay(deps, { type: 'BUY_GOODS', amount: 10, counterparty: { tillNumber: '453851', name: 'Shop' } });
    expect((await syncOutbox(deps, down)).error).toBe('fetch failed');
    await pay(deps, { type: 'BUY_GOODS', amount: 20, counterparty: { tillNumber: '453851', name: 'Shop' } });
    expect((await deps.store.getAccount())!.currentBalanceCache).toBe(9_970);
    const back = await syncOutbox(deps, http(token));
    expect(back.synced).toBe(3);
    expect(back.server!.balance).toBe(9_970);
  });

  it('never trusts the phone: a tampered fee or balance is kept for review, not applied', async () => {
    const { deps, token } = await newAccount();
    await pay(deps, { type: 'SEND_MONEY', amount: 1_000, counterparty: { phone: '0722000111', name: 'Peter Kamau' } });
    await pay(deps, { type: 'BUY_GOODS', amount: 50, counterparty: { tillNumber: '453851', name: 'Shop' } });
    // tamper with the first payment's fee and balance before upload (e.g. a modified app)
    const state = (deps.store as MemoryStore).snapshot();
    const send = state.transactions.find((t) => t.type === 'SEND_MONEY')!;
    send.fee = 0;
    send.totalDebit = 1_000;
    send.balanceAfter = 9_000;
    const tampered = { ...deps, store: new MemoryStore(state as MemoryState) };

    const report = await syncOutbox(tampered, http(token));
    expect(report.synced).toBe(1); // the account itself
    expect(report.needsReview).toBe(1); // the tampered payment
    expect(report.held).toBe(1); // the one built on its balance waits instead of piling up in review
    expect(report.server!.balance).toBe(10_000); // nothing applied
    const reviewed = await db.query<{ code: string }>('SELECT code FROM sync_review WHERE installation_id = $1 ORDER BY id', [deps.installationId]);
    expect(reviewed.map((r) => r.code)).toEqual(['FEE_MISMATCH']);
    const local = await tampered.store.listTransactions();
    expect(local.filter((t) => t.syncStatus === 'NEEDS_REVIEW')).toHaveLength(1);
    // retrying returns the same verdict without new review rows; the later one keeps waiting
    const again = await syncOutbox(tampered, http(token));
    expect(again.held).toBe(1);
    expect((await db.query('SELECT 1 FROM sync_review WHERE installation_id = $1', [deps.installationId])).length).toBe(1);
  });

  it('a transaction type switched off in the back office is held for review, judged at the time it happened', async () => {
    // Off from 1 May to 1 July 2025 only (other tests run at later times and see everything on).
    await db.query('INSERT INTO monetization_settings_history (effective_from, settings) VALUES ($1, $2), ($3, $4)', [
      '2025-05-01T00:00:00Z', JSON.stringify({ transactionTypeControls: { BUY_GOODS: false } }), '2025-07-01T00:00:00Z', JSON.stringify({}),
    ]);
    const deps = makeDeps();
    let t = Date.parse('2025-06-01T06:00:00.000Z');
    deps.clock = { now: () => new Date((t += 60_000)).toISOString() };
    // the phone had not heard of the switch yet (offline), so its engine allowed both
    await setupAccount(deps, { operationId: randomUUID(), accountName: 'Amina Wanjiru', phoneNumber: '0798765432', openingBalance: 10_000, pin: PIN });
    const token = await register(deps.installationId);
    await pay(deps, { type: 'SEND_MONEY', amount: 100, counterparty: { phone: '0722000111', name: 'Peter Kamau' } });
    await pay(deps, { type: 'BUY_GOODS', amount: 50, counterparty: { tillNumber: '453851', name: 'Shop' } });
    const report = await syncOutbox(deps, http(token));
    expect([report.synced, report.needsReview]).toEqual([2, 1]);
    const reviewed = await db.query<{ code: string }>('SELECT code FROM sync_review WHERE installation_id = $1', [deps.installationId]);
    expect(reviewed.map((r) => r.code)).toEqual(['TYPE_DISABLED']);

    // and a phone that knows the switch refuses it itself
    const knows = { ...deps, config: { ...deps.config, monetization: { ...deps.config.monetization, transactionTypeControls: { BUY_GOODS: false } } } };
    const refused = await pay(knows, { type: 'BUY_GOODS', amount: 50, counterparty: { tillNumber: '453851', name: 'Shop' } });
    expect(refused.ok ? null : refused.error.code).toBe('TYPE_DISABLED');
  });

  it('an operation ID reused for different content is a conflict', async () => {
    const { deps, token } = await newAccount();
    const r = await pay(deps, { type: 'BUY_GOODS', amount: 10, counterparty: { tillNumber: '453851', name: 'Shop' } });
    if (!r.ok) throw new Error('payment failed');
    await syncOutbox(deps, http(token));
    const tx = { ...r.transaction, amount: 11 };
    const { syncStatus: _s, ...upload } = tx;
    const res = await http(token).push({
      apiVersion: 1, installationId: deps.installationId,
      operations: [{ operationId: r.transaction.operationId, entityType: 'TRANSACTION', operationType: 'CREATE_SIMULATION', payloadVersion: 1, createdAt: tx.createdAt, payload: { transaction: upload, message: null } }],
    });
    expect(res.results[0]).toMatchObject({ status: 'NEEDS_REVIEW', code: 'OPERATION_CONFLICT' });
    expect(res.server!.balance).toBe(9_990);
  });

  it('requires a registered installation and keeps installations apart', async () => {
    const a = await newAccount();
    const b = await newAccount();
    const noAuth = await fetch(`${baseUrl}/v1/sync/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(noAuth.status).toBe(401);
    expect(((await noAuth.json()) as Json).error.code).toBe('UNAUTHORIZED');
    // b's token cannot push a's operations
    const res = await fetch(`${baseUrl}/v1/sync/push`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${b.token}` },
      body: JSON.stringify({ apiVersion: 1, installationId: a.deps.installationId, operations: [] }),
    });
    expect(res.status).toBe(403);
    // registration is retry-safe with the same secret, refused with another
    const again = await fetch(`${baseUrl}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: a.deps.installationId, token: a.token }) });
    expect(again.status).toBe(200);
    const other = await fetch(`${baseUrl}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: a.deps.installationId, token: randomBytes(32).toString('base64url') }) });
    expect(other.status).toBe(409);
    expect((await get('/v1/health', a.token)).body).toMatchObject({ ok: true, apiVersion: 1 });
  });
});
