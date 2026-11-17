/**
 * Device token allocations end to end (White Paper §29, §33.2, §47.5): the real engine + sync client on the
 * "phone", HTTP to the real Nest app, PostgreSQL (PGlite) behind it.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MemoryStore,
  processSimulation,
  setTokenAllocation,
  setupAccount,
  syncOutbox,
  type EngineDeps,
  type ServerAllocation,
  type SyncPushResponse,
  type SyncTransport,
} from '@paspesa/core';
import { AllocationService } from '../src/allocation.service.js';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';
import { MonetizationService } from '../src/monetization.service.js';

let db: Database;
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let money: MonetizationService;

beforeAll(async () => {
  db = await openDatabase({});
  app = await createApp(db);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  money = new MonetizationService(db);
  await money.updateSettings({ paymentRequired: true }, 'admin:test'); // payments switched on for this suite
});
afterAll(async () => {
  await app.close();
  await db.close();
});

/** A phone: engine deps with payments on, registered with the server and synced. */
async function phone() {
  let t = Date.now();
  const deps: EngineDeps = {
    store: new MemoryStore(),
    config: { ...DEFAULT_CONFIG, monetization: { ...DEFAULT_CONFIG.monetization, paymentRequired: true } },
    clock: { now: () => new Date((t += 1000)).toISOString() },
    ids: { uuid: () => randomUUID() },
    random: { int: (max) => Math.floor(Math.random() * max) },
    pinHasher: { hash: async (pin, salt) => `h(${salt}:${pin})` },
    installationId: randomUUID(),
  };
  const token = randomBytes(32).toString('hex');
  await fetch(`${base}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: deps.installationId, token, platform: 'android' }) });
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const transport: SyncTransport = {
    async push(request) {
      const res = await fetch(`${base}/v1/sync/push`, { method: 'POST', headers: auth, body: JSON.stringify(request) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SyncPushResponse;
    },
  };
  const setup = await setupAccount(deps, { operationId: randomUUID(), accountName: 'Paskal Twoli', phoneNumber: '0759981287', openingBalance: 50_000, pin: '1234' });
  if (!setup.ok) throw new Error(setup.error.message);
  await syncOutbox(deps, transport);
  const accountId = (await deps.store.getAccount())!.id;
  const call = async <T>(path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${base}${path}`, body === undefined ? { headers: auth } : { method: 'POST', headers: auth, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { deps, transport, accountId, call };
}

const send = (amount: number, extra: object = {}) => ({ operationId: randomUUID(), type: 'SEND_MONEY' as const, amount, counterparty: { phone: '0706573273', name: 'Getrude Ohanga' }, pin: '1234', ...extra });

describe('device token allocations (§29)', () => {
  it('reserve online → spend offline → sync turns spends into ledger expenditure → release after reconciling', async () => {
    const p = await phone();
    await money.grant({ accountId: p.accountId, category: 'PURCHASED', quantity: 100, reference: `payment:${randomUUID()}`, actor: 'test' });
    await money.grant({ accountId: p.accountId, category: 'PROMOTIONAL', quantity: 30, reference: `promo:${randomUUID()}`, actor: 'test' });

    // reserve 50: promotional first (30), then purchased (20); central balance keeps 80
    const granted = await p.call<{ allocation: ServerAllocation }>('/v1/allocations', { quantity: 50 });
    expect(granted.body.allocation).toMatchObject({ remaining: 50 });
    expect((await money.wallet(p.accountId))).toMatchObject({ balances: { total: 80, PROMOTIONAL: 0, PURCHASED: 80 }, reservedForDevices: 50 });
    await setTokenAllocation(p.deps, { ...granted.body.allocation });

    // offline: two KSh 100 sends at 20 tokens each, paid with tokens
    for (let i = 0; i < 2; i++) {
      const r = await processSimulation(p.deps, send(100, { paymentMethod: 'TOKENS' }));
      if (!r.ok) throw new Error(r.error.message);
    }
    expect((await p.deps.store.getAccount())!.tokenAllocation!.remaining).toBe(10);
    const unpaid = await processSimulation(p.deps, send(100));
    expect(!unpaid.ok && unpaid.error.code).toBe('PAYMENT_REQUIRED');

    // back online: sync spends from the reservation (promotional lots first) and renews the authorization
    const report = await syncOutbox(p.deps, p.transport);
    expect([report.error, report.needsReview]).toEqual([null, 0]);
    expect((await p.deps.store.getAccount())!.tokenAllocation!.remaining).toBe(10);
    const spends = await db.query<{ source_category: string; quantity: number }>(
      "SELECT l.source_category, l.quantity FROM token_ledger l JOIN token_wallets w ON w.id = l.wallet_id WHERE w.owner_id = $1 AND l.entry_type = 'SIMULATION_EXPENDITURE' ORDER BY l.seq",
      [p.accountId],
    );
    expect(spends.map((s) => [s.source_category, Number(s.quantity)])).toEqual([['PROMOTIONAL', 20], ['PROMOTIONAL', 10], ['PURCHASED', 10]]);
    expect(await money.reconcile(p.accountId)).toEqual([]);

    // release: refused while the phone's figure disagrees, then returns the 10 unused tokens
    expect((await p.call('/v1/allocations/release', { deviceRemaining: 30 })).status).toBe(422);
    expect((await p.call<{ released: number }>('/v1/allocations/release', { deviceRemaining: 10 })).body).toEqual({ released: 10 });
    expect((await money.wallet(p.accountId))).toMatchObject({ balances: { total: 90 }, reservedForDevices: 0 });
    expect(await money.reconcile(p.accountId)).toEqual([]);
  });

  it('a tampered token price is kept for review, not charged', async () => {
    const p = await phone();
    await money.grant({ accountId: p.accountId, category: 'ADMIN', quantity: 40, reference: `admin:${randomUUID()}`, actor: 'test' });
    const { body } = await p.call<{ allocation: ServerAllocation }>('/v1/allocations', { quantity: 40 });
    await setTokenAllocation(p.deps, body.allocation);
    const r = await processSimulation(p.deps, send(100, { paymentMethod: 'TOKENS' }));
    if (!r.ok) throw new Error('failed');
    const state = (p.deps.store as MemoryStore).snapshot();
    state.transactions.find((t) => t.id === r.transaction.id)!.pricing!.tokenCost = 5; // modified app claims 5 tokens
    const tampered = { ...p.deps, store: new MemoryStore(state) };
    const report = await syncOutbox(tampered, p.transport);
    expect(report.needsReview).toBe(1);
    const [rev] = await db.query<{ code: string }>('SELECT code FROM sync_review WHERE installation_id = $1', [p.deps.installationId]);
    expect(rev!.code).toBe('PRICING_MISMATCH');
    expect((await p.call<{ allocation: ServerAllocation }>('/v1/allocations/current')).body.allocation.remaining).toBe(40);
  });

  it('a lost device forfeits its unreconciled tokens as a ledger event, without inventing transactions', async () => {
    const p = await phone();
    await money.grant({ accountId: p.accountId, category: 'PURCHASED', quantity: 60, reference: `payment:${randomUUID()}`, actor: 'test' });
    const { body } = await p.call<{ allocation: ServerAllocation }>('/v1/allocations', { quantity: 40 });
    await setTokenAllocation(p.deps, body.allocation);
    await processSimulation(p.deps, send(100, { paymentMethod: 'TOKENS' })); // spent offline, never uploaded (phone lost)
    const txBefore = await db.query('SELECT 1 FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.installation_id = $1', [p.deps.installationId]);

    const result = await new AllocationService(db, money).forfeitLostDevice(p.deps.installationId, 'admin:test', 'Phone stolen');
    expect(result).toEqual({ forfeited: 40 }); // never assumed unused
    expect((await money.wallet(p.accountId))).toMatchObject({ balances: { total: 20 }, reservedForDevices: 0 });
    const events = await db.query<{ entry_type: string; quantity: number }>(
      "SELECT l.entry_type, l.quantity FROM token_ledger l JOIN token_wallets w ON w.id = l.wallet_id WHERE w.owner_id = $1 AND l.entry_type = 'LOST_DEVICE_FORFEITURE'",
      [p.accountId],
    );
    expect(events.map((e) => Number(e.quantity))).toEqual([40]);
    const txAfter = await db.query('SELECT 1 FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.installation_id = $1', [p.deps.installationId]);
    expect(txAfter.length).toBe(txBefore.length);
    expect(await money.reconcile(p.accountId)).toEqual([]);
    expect((await db.query("SELECT 1 FROM audit_log WHERE action = 'FORFEIT_LOST_DEVICE' AND entity_id = $1", [p.deps.installationId])).length).toBe(1);
    // the lost phone can no longer reserve tokens
    expect((await p.call('/v1/allocations', { quantity: 5 })).status).toBe(422);
  });

  it('reserved tokens cannot be spent centrally, and do not expire while reserved', async () => {
    const p = await phone();
    await money.grant({ accountId: p.accountId, category: 'PROMOTIONAL', quantity: 20, reference: `promo:${randomUUID()}`, expiresAt: '2026-01-01T00:00:00Z', actor: 'test' });
    // already expired: nothing available to reserve
    expect((await p.call('/v1/allocations', { quantity: 10 })).status).toBe(422);
    await money.grant({ accountId: p.accountId, category: 'PURCHASED', quantity: 10, reference: `payment:${randomUUID()}`, actor: 'test' });
    expect((await p.call('/v1/allocations', { quantity: 10 })).status).toBe(200);
    const pricing = await money.quote(p.accountId, 'SEND_MONEY', 25); // 5 tokens
    await expect(money.spendForSimulation({ accountId: p.accountId, simulationId: randomUUID(), pricing })).rejects.toThrow(/0 are available/);
  });
});
