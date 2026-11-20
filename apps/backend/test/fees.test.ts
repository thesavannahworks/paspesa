/**
 * Editable fee schedules (owner, 2026-11-20): versions published from the back office reach devices with the
 * pricing they fetch; uploads are checked with the version they used (offline phones keep working), and a
 * version the server never published is not accepted.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MemoryStore,
  processSimulation,
  setupAccount,
  syncOutbox,
  type EngineDeps,
  type FeeSchedule,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncTransport,
} from '@paspesa/core';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';
import { FeeService } from '../src/fees.service.js';

let db: Database;
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;

beforeAll(async () => {
  db = await openDatabase({});
  app = await createApp(db);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  await db.close();
});

async function phone() {
  let t = Date.now() - 3_600_000;
  const deps: EngineDeps = {
    store: new MemoryStore(),
    config: DEFAULT_CONFIG,
    clock: { now: () => new Date((t += 1_000)).toISOString() },
    ids: { uuid: () => randomUUID() },
    random: { int: (max) => Math.floor(Math.random() * max) },
    pinHasher: { hash: async (pin, salt) => `h(${salt}:${pin})` },
    installationId: randomUUID(),
  };
  const token = randomBytes(32).toString('base64url');
  await fetch(`${base}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: deps.installationId, token }) });
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const transport: SyncTransport = {
    async push(request: SyncPushRequest) {
      const res = await fetch(`${base}/v1/sync/push`, { method: 'POST', headers: auth, body: JSON.stringify(request) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SyncPushResponse;
    },
  };
  await setupAccount(deps, { operationId: randomUUID(), accountName: 'Amina Wanjiru', phoneNumber: '0798765432', openingBalance: 50_000, pin: '1234' });
  await syncOutbox(deps, transport);
  /** What the phone does on every sync: fetch pricing, settings and fee schedules. */
  const fetchConfig = async () => {
    const cfg = (await (await fetch(`${base}/v1/pricing`, { headers: auth })).json()) as { feeSchedules: FeeSchedule[] };
    deps.config = { ...deps.config, feeSchedules: cfg.feeSchedules };
    return cfg.feeSchedules;
  };
  return { deps, transport, fetchConfig };
}

const send = (deps: EngineDeps, amount: number) =>
  processSimulation(deps, { operationId: randomUUID(), type: 'SEND_MONEY', amount, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, pin: '1234' });

describe('editable fee schedules', () => {
  it('refuses schedules with gaps, overlaps, non-whole numbers or no change', async () => {
    const fees = new FeeService(db);
    const [sendMoney] = (await fees.current()).filter((s) => s.id === 'SEND_MONEY');
    const bands = sendMoney!.bands;
    await expect(fees.publish('SEND_MONEY', bands, 'admin:test')).rejects.toThrow(/Nothing changed/);
    await expect(fees.publish('SEND_MONEY', [bands[0]!, { ...bands[2]! }], 'admin:test')).rejects.toThrow(/gap/);
    await expect(fees.publish('SEND_MONEY', [bands[0]!, { ...bands[1]!, min: bands[0]!.max }], 'admin:test')).rejects.toThrow(/overlaps/);
    await expect(fees.publish('SEND_MONEY', [{ ...bands[0]!, fee: -1 }, ...bands.slice(1)], 'admin:test')).rejects.toThrow(/negative/);
    await expect(fees.publish('NO_SUCH', bands, 'admin:test')).rejects.toThrow(/Unknown/);
  });

  it('a new version reaches phones; uploads with it, or with the old one made offline, are accepted; invented fees are not', async () => {
    const a = await phone();
    const offline = await phone(); // never fetches the new fees
    const fees = new FeeService(db);
    const before = (await fees.current()).find((s) => s.id === 'SEND_MONEY')!;
    const band = before.bands.find((b) => 400 >= b.min && 400 <= b.max)!;
    const changed = before.bands.map((b) => (b === band ? { ...b, fee: b.fee + 3 } : b));
    const published = await fees.publish('SEND_MONEY', changed, 'admin:test', 'test');
    expect(published.version).toBe(before.version + 1);

    const delivered = (await a.fetchConfig()).find((s) => s.id === 'SEND_MONEY')!;
    expect(delivered).toMatchObject({ version: published.version });
    const paid = await send(a.deps, 400);
    expect(paid.ok && paid.transaction).toMatchObject({ fee: band.fee + 3, feeScheduleVersion: published.version });
    expect((await syncOutbox(a.deps, a.transport)).needsReview).toBe(0);

    const old = await send(offline.deps, 400); // still the built-in version
    expect(old.ok && old.transaction.fee).toBe(band.fee);
    expect((await syncOutbox(offline.deps, offline.transport)).needsReview).toBe(0);

    // a phone claiming a version the server never published is checked against the real fees: kept for review
    offline.deps.config = { ...offline.deps.config, feeSchedules: offline.deps.config.feeSchedules.map((s) => (s.id === 'SEND_MONEY' ? { ...s, version: 99, bands: s.bands.map((b) => ({ ...b, fee: 0 })) } : s)) };
    await send(offline.deps, 400);
    expect((await syncOutbox(offline.deps, offline.transport)).needsReview).toBe(1);

    const [audit] = await db.query<{ action: string; entity_id: string }>("SELECT action, entity_id FROM audit_log WHERE action = 'PUBLISH_FEE_SCHEDULE' ORDER BY id DESC LIMIT 1");
    expect(audit).toMatchObject({ entity_id: `SEND_MONEY@${published.version}` });
  });
});
