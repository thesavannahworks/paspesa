/**
 * Account sign-in by email code, one active device per account, restoring onto a new device, and the
 * old device's leftover uploads. Real app over HTTP against PGlite.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MemoryStore,
  processSimulation,
  setPin,
  setupAccount,
  stateFromSnapshot,
  syncOutbox,
  applyReviewOutcomes,
  outboxSummary,
  type AccountSnapshot,
  type EngineDeps,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncTransport,
} from '@paspesa/core';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';
import { memoryMailer } from '../src/mailer.js';
import { MonetizationService } from '../src/monetization.service.js';
import { SyncService } from '../src/sync.service.js';
import { SuspensionService } from '../src/suspension.js';

let db: Database;
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
const mailer = memoryMailer();
const PIN = '1234';

beforeAll(async () => {
  db = await openDatabase({});
  app = await createApp(db, { mailer });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  await db.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function makeDeps(startIso: string, installationId = randomUUID(), store = new MemoryStore()): EngineDeps & { setTime(iso: string): void } {
  let t = Date.parse(startIso);
  return {
    store,
    config: DEFAULT_CONFIG,
    clock: { now: () => new Date((t += 60_000)).toISOString() },
    ids: { uuid: () => randomUUID() },
    random: { int: (max) => Math.floor(Math.random() * max) },
    pinHasher: { hash: async (pin, salt) => `h(${salt}:${pin})` },
    installationId,
    setTime(iso: string) { t = Date.parse(iso); },
  };
}

async function device() {
  const installationId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const res = await fetch(`${base}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId, token }) });
  expect(res.status).toBe(200);
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Json };
  };
  const transport: SyncTransport = {
    async push(request: SyncPushRequest) {
      const r = await call('POST', '/v1/sync/push', request);
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      return r.body as SyncPushResponse;
    },
  };
  return { installationId, token, call, transport };
}

const lastCode = (email: string) => {
  const mail = [...mailer.sent].reverse().find((m) => m.to === email)!;
  return /(\d{6})/.exec(mail.subject)![1]!;
};

async function signIn(d: Awaited<ReturnType<typeof device>>, email: string, replaceLocalAccount = false) {
  await db.query('DELETE FROM sign_in_codes WHERE email = $1', [email]); // tests skip the one-a-minute wait
  const sent = await d.call('POST', '/v1/auth/code', { email });
  expect(sent.status).toBe(200);
  return d.call('POST', '/v1/auth/verify', { email, code: lastCode(email), replaceLocalAccount });
}

const send = (deps: EngineDeps, amount: number) =>
  processSimulation(deps, { operationId: randomUUID(), type: 'SEND_MONEY', amount, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, pin: PIN });

describe('sign-in codes', () => {
  it('emails a 6-digit code; wrong codes count down; the code works once', async () => {
    const d = await device();
    const sent = await d.call('POST', '/v1/auth/code', { email: ' Wanjiku@Example.com ' });
    expect(sent.body).toEqual({ sent: true, resendAfterSeconds: 60 });
    expect(mailer.sent.at(-1)!.to).toBe('wanjiku@example.com');
    const code = lastCode('wanjiku@example.com');
    expect(mailer.sent.at(-1)!.text).toContain(code);
    const [row] = await db.query<{ code_hash: string }>("SELECT code_hash FROM sign_in_codes WHERE email = 'wanjiku@example.com'");
    expect(row!.code_hash).not.toContain(code); // only a salted hash is stored

    const again = await d.call('POST', '/v1/auth/code', { email: 'wanjiku@example.com' });
    expect(again.status).toBe(429); // one a minute

    const wrong = await d.call('POST', '/v1/auth/verify', { email: 'wanjiku@example.com', code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toMatch(/4 tries left/);
    const ok = await d.call('POST', '/v1/auth/verify', { email: 'wanjiku@example.com', code });
    expect(ok.body).toEqual({ email: 'wanjiku@example.com', accountId: null, movedFromAnotherDevice: false });
    const reused = await d.call('POST', '/v1/auth/verify', { email: 'wanjiku@example.com', code });
    expect(reused.status).toBe(410);
    expect((await d.call('GET', '/v1/auth/me')).body).toMatchObject({ signedIn: true, email: 'wanjiku@example.com', accountId: null });
  });

  it('locks a code after 5 wrong tries, and refuses bad input', async () => {
    const d = await device();
    await d.call('POST', '/v1/auth/code', { email: 'otieno@example.com' });
    const code = lastCode('otieno@example.com');
    const bad = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await d.call('POST', '/v1/auth/verify', { email: 'otieno@example.com', code: bad });
    expect((await d.call('POST', '/v1/auth/verify', { email: 'otieno@example.com', code })).status).toBe(429);
    expect((await d.call('POST', '/v1/auth/code', { email: 'not-an-email' })).status).toBe(400);
  });
});

describe('one account, moving between devices', () => {
  it('signing in then creating an account makes it the email\'s account', async () => {
    const d = await device();
    expect((await signIn(d, 'achieng@example.com')).body.accountId).toBeNull();
    const deps = makeDeps('2025-01-01T06:00:00.000Z', d.installationId);
    const created = await setupAccount(deps, { operationId: randomUUID(), accountName: 'Achieng Odhiambo', phoneNumber: '0798765432', openingBalance: 5_000, pin: PIN });
    expect(created.ok).toBe(true);
    expect((await syncOutbox(deps, d.transport)).error).toBeNull();
    const [acct] = await db.query<{ email: string }>('SELECT u.email FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.installation_id = $1', [d.installationId]);
    expect(acct!.email).toBe('achieng@example.com');
  });

  it('moves the account to a new device, restores it there, and signs the old device out', async () => {
    // Phone A: account, signed in, some simulations synced
    const a = await device();
    const depsA = makeDeps('2025-01-01T06:00:00.000Z', a.installationId);
    await setupAccount(depsA, { operationId: randomUUID(), accountName: 'Amina Wanjiru', phoneNumber: '0798765432', openingBalance: 20_000, pin: PIN });
    await send(depsA, 400);
    await syncOutbox(depsA, a.transport);
    expect((await signIn(a, 'paskal@example.com')).body.accountId).toBe((await depsA.store.getAccount())!.id);
    // A records one more before the move, not uploaded yet
    await send(depsA, 300);

    // Desktop B signs in with the same email: the account moves to B
    const b = await device();
    const moved = await signIn(b, 'paskal@example.com');
    expect(moved.body).toMatchObject({ accountId: (await depsA.store.getAccount())!.id, movedFromAnotherDevice: true });
    expect((await a.call('GET', '/v1/auth/me')).body).toMatchObject({ signedIn: false, signedOutElsewhere: true });
    expect((await a.call('GET', '/v1/account/restore')).status).toBe(403); // only the active device restores

    // A's upload after the move is held for review (B continues from the server's ledger), and A is told
    const leftover = await syncOutbox(depsA, a.transport);
    expect(leftover.needsReview).toBe(1);
    const [held] = await db.query<{ code: string }>('SELECT code FROM sync_review WHERE installation_id = $1', [a.installationId]);
    expect(held!.code).toBe('SIGNED_OUT');
    const pushed = await a.call('POST', '/v1/sync/push', { apiVersion: 1, installationId: a.installationId, operations: [] });
    expect(pushed.body.signedOut).toBe(true);

    // B restores the server's ledger (without A's held 300), creates its own PIN and continues
    const snap = (await b.call('GET', '/v1/account/restore')).body as AccountSnapshot;
    const state = stateFromSnapshot(snap, b.installationId);
    expect(state.account!.currentBalanceCache).toBe((await depsA.store.listTransactions()).find((t) => t.amount === 400)!.balanceAfter);
    expect(state.transactions).toHaveLength(2);
    expect(state.account!.pin).toBeNull(); // the PIN never leaves a device
    expect(state.messages.length).toBe(1);
    const depsB = makeDeps('2025-06-01T06:00:00.000Z', b.installationId, new MemoryStore(state));
    expect((await send(depsB, 100)).ok).toBe(false); // no PIN yet
    expect((await setPin(depsB, { newPin: PIN })).ok).toBe(true);
    expect((await send(depsB, 100)).ok).toBe(true);
    const fromB = await syncOutbox(depsB, b.transport);
    expect(fromB.needsReview).toBe(0);
    expect(fromB.server!.balance).toBe((await depsB.store.getAccount())!.currentBalanceCache);

    // A's later simulations wait behind the held one instead of piling up in review
    depsA.setTime('2031-01-01T00:00:00.000Z');
    await send(depsA, 50);
    const late = await syncOutbox(depsA, a.transport);
    expect(late.held).toBe(1);
    expect(late.uploaded).toBe(0);

    // the held one no longer fits (B continued): applying is refused; dismissing tells device A
    const [item] = await db.query<{ id: string }>('SELECT id FROM sync_review WHERE installation_id = $1', [a.installationId]);
    const sync = new SyncService(db);
    expect(await sync.applyReview(item!.id, 'admin:test', '')).toMatchObject({ ok: false });
    expect(await sync.dismissReview(item!.id, 'admin:test', 'Account moved to the desktop')).toBe(true);
    const state2 = (await a.call('GET', '/v1/sync/state')).body;
    expect(state2.reviewed).toEqual([expect.objectContaining({ status: 'DISMISSED' })]);
    expect(await applyReviewOutcomes(depsA, state2.reviewed)).toBe(1);
    expect((await outboxSummary(depsA.store)).dismissed).toBe(1);
  });

  it('judges an offline simulation by the settings when it happened; a reviewer can apply a held one', async () => {
    const money = new MonetizationService(db);
    await money.updateSettings({ paymentRequired: false }, 'admin:test');
    const d = await device();
    const deps = makeDeps(new Date(Date.now() - 3_600_000).toISOString(), d.installationId);
    await setupAccount(deps, { operationId: randomUUID(), accountName: 'Wanjiru', phoneNumber: '0711222333', openingBalance: 5_000, pin: PIN });
    await syncOutbox(deps, d.transport);
    await send(deps, 500); // free: payments were off (an hour ago, on the device clock)
    await money.updateSettings({ paymentRequired: true }, 'admin:test'); // switched on before the upload
    const r = await syncOutbox(deps, d.transport);
    expect(r.needsReview).toBe(0); // judged by the settings at the time
    expect(r.server!.balance).toBe((await deps.store.getAccount())!.currentBalanceCache);

    // now payments are on: a free (unpaid) simulation is held; the next one waits behind it
    deps.setTime(new Date(Date.now() + 60_000).toISOString());
    await send(deps, 400);
    await send(deps, 300);
    const held = await syncOutbox(deps, d.transport);
    expect(held.needsReview).toBe(1);
    expect(held.held).toBe(1);
    const [item] = await db.query<{ id: string; code: string }>('SELECT id, code FROM sync_review WHERE installation_id = $1', [d.installationId]);
    expect(item!.code).toBe('PAYMENT_REQUIRED');

    // a reviewer applies it (it still fits); the device learns, and the waiting one uploads
    expect(await new SyncService(db).applyReview(item!.id, 'admin:test', 'Payments were off for this phone')).toEqual({ ok: true });
    const st = (await d.call('GET', '/v1/sync/state')).body;
    expect(st.reviewed).toEqual([expect.objectContaining({ status: 'SYNCED' })]);
    await applyReviewOutcomes(deps, st.reviewed);
    await money.updateSettings({ paymentRequired: false }, 'admin:test');
    const after = await syncOutbox(deps, d.transport);
    expect(after).toMatchObject({ held: 0, needsReview: 0, synced: 1 });
    expect(after.server!.balance).toBe((await deps.store.getAccount())!.currentBalanceCache);
    expect((await db.query("SELECT 1 FROM audit_log WHERE action = 'APPLY_REVIEW'")).length).toBe(1);
  });

  it('a device with its own account must choose before using an email that has another account', async () => {
    const owner = await device();
    const depsO = makeDeps('2025-01-01T06:00:00.000Z', owner.installationId);
    await setupAccount(depsO, { operationId: randomUUID(), accountName: 'Mary Atieno', phoneNumber: '0722000111', openingBalance: 1_000, pin: PIN });
    await syncOutbox(depsO, owner.transport);
    await signIn(owner, 'mary@example.com');

    const other = await device();
    const depsX = makeDeps('2025-01-01T06:00:00.000Z', other.installationId);
    await setupAccount(depsX, { operationId: randomUUID(), accountName: 'Someone Else', phoneNumber: '0733000222', openingBalance: 2_000, pin: PIN });
    await syncOutbox(depsX, other.transport);
    const conflict = await signIn(other, 'mary@example.com');
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('ACCOUNT_CONFLICT');
    const replaced = await signIn(other, 'mary@example.com', true);
    expect(replaced.body).toMatchObject({ accountId: (await depsO.store.getAccount())!.id, movedFromAnotherDevice: true });
  });

  it('signing out on the device itself', async () => {
    const d = await device();
    await signIn(d, 'kamau@example.com');
    expect((await d.call('POST', '/v1/auth/sign-out')).body).toEqual({ signedOut: true });
    expect((await d.call('GET', '/v1/auth/me')).body.signedIn).toBe(false);
    expect((await signIn(d, 'kamau@example.com')).status).toBe(200);
    expect((await d.call('GET', '/v1/auth/me')).body.signedIn).toBe(true);
  });

  it('after signing out, any other email can sign in on the device', async () => {
    const d = await device();
    await signIn(d, 'first@example.com');
    const deps = makeDeps('2025-01-01T06:00:00.000Z', d.installationId);
    await setupAccount(deps, { operationId: randomUUID(), accountName: 'First Person', phoneNumber: '0712000001', openingBalance: 1_000, pin: PIN });
    await syncOutbox(deps, d.transport);
    await d.call('POST', '/v1/auth/sign-out');
    const second = await signIn(d, 'second@example.com'); // no account yet: sets one up
    expect(second.status).toBe(200);
    expect(second.body.accountId).toBeNull();
    const back = await signIn(d, 'first@example.com'); // and the first email gets its account back
    expect(back.body.accountId).toBe((await deps.store.getAccount())!.id);
  });

  it('a device whose account moved elsewhere, or that holds another email\'s account, can switch to a new email', async () => {
    const a = await device();
    await signIn(a, 'mover@example.com');
    const depsA = makeDeps('2025-01-01T06:00:00.000Z', a.installationId);
    await setupAccount(depsA, { operationId: randomUUID(), accountName: 'Mover', phoneNumber: '0712000002', openingBalance: 1_000, pin: PIN });
    await syncOutbox(depsA, a.transport);
    const b = await device();
    await signIn(b, 'mover@example.com'); // the account moves to b; a was wiped
    expect((await signIn(a, 'newcomer@example.com')).body).toMatchObject({ accountId: null }); // no conflict

    // b holds mover's account; a brand-new email asks to switch
    const conflict = await signIn(b, 'fresh@example.com');
    expect(conflict.status).toBe(409);
    const switched = await signIn(b, 'fresh@example.com', true);
    expect(switched.status).toBe(200);
    expect(switched.body.accountId).toBeNull();
    const [mover] = await db.query<{ installation_id: string | null }>("SELECT a.installation_id FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = 'mover@example.com'");
    expect(mover!.installation_id).toBeNull(); // kept on the server, waiting for its email
  });

  it('online with nothing set aside, a paid simulation is paid from the central token balance', async () => {
    const money = new MonetizationService(db);
    const d = await device();
    const deps = makeDeps(new Date(Date.now() - 600_000).toISOString(), d.installationId);
    await setupAccount(deps, { operationId: randomUUID(), accountName: 'Tokens Online', phoneNumber: '0712000003', openingBalance: 10_000, pin: PIN });
    await syncOutbox(deps, d.transport);
    const accountId = (await deps.store.getAccount())!.id;
    await money.grant({ accountId, category: 'PROMOTIONAL', quantity: 30, reference: `promo:${randomUUID()}`, actor: 'test' });
    await money.updateSettings({ paymentRequired: true }, 'admin:test');
    deps.config = { ...deps.config, pricing: await money.pricing(), monetization: { ...deps.config.monetization, paymentRequired: true } };
    try {
      const pay = (amount: number) => processSimulation(deps, { operationId: randomUUID(), type: 'SEND_MONEY', amount, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, pin: PIN, paymentMethod: 'WALLET' });
      const first = await pay(100); // 20 tokens (KSh 5 per token above the free KSh 20 threshold → full amount)
      expect(first.ok).toBe(true);
      const cost = first.ok ? first.transaction.pricing!.tokenCost : 0;
      expect(cost).toBeGreaterThan(0);
      const r = await syncOutbox(deps, d.transport);
      expect(r.needsReview).toBe(0);
      expect((await money.wallet(accountId)).balances.total).toBe(30 - cost);
      // not enough left: kept for review instead of going negative
      await pay(500);
      const r2 = await syncOutbox(deps, d.transport);
      expect(r2.needsReview).toBe(1);
      const [item] = await db.query<{ code: string }>('SELECT code FROM sync_review WHERE installation_id = $1', [d.installationId]);
      expect(item!.code).toBe('INSUFFICIENT_TOKENS');
    } finally {
      await money.updateSettings({ paymentRequired: false }, 'admin:test');
    }
  });
});

describe('suspensions (reversible)', () => {
  it('a suspended device is refused everything until it is reinstated; its data waits', async () => {
    const d = await device();
    await signIn(d, 'suspend-device@example.com');
    const deps = makeDeps('2025-01-01T06:00:00.000Z', d.installationId);
    await setupAccount(deps, { operationId: randomUUID(), accountName: 'Device Suspended', phoneNumber: '0712000010', openingBalance: 1_000, pin: PIN });
    await syncOutbox(deps, d.transport);
    const suspensions = new SuspensionService(db);
    expect(await suspensions.suspend('DEVICE', d.installationId, 'admin:test', 'Misuse')).toBe(true);
    expect(await suspensions.suspend('DEVICE', d.installationId, 'admin:test', 'Again')).toBe(false);

    const refused = await d.call('GET', '/v1/sync/state');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('DEVICE_SUSPENDED');
    expect(refused.body.error.message).toMatch(/Misuse/);
    expect((await d.call('POST', '/v1/auth/code', { email: 'other@example.com' })).status).toBe(403);
    await send(deps, 100);
    expect((await syncOutbox(deps, d.transport)).error).not.toBeNull(); // nothing uploads…

    expect(await suspensions.reinstate('DEVICE', d.installationId, 'admin:test', 'Talked to them')).toBe(true);
    const report = await syncOutbox(deps, d.transport); // …until reinstated
    expect([report.error, report.needsReview]).toEqual([null, 0]);
    const audit = await db.query<{ action: string }>("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id", [d.installationId]);
    expect(audit.map((a) => a.action)).toEqual(['SUSPEND_DEVICE', 'REINSTATE_DEVICE']);
  });

  it('a suspended account cannot sign in or sync; its device may still sign out and switch email', async () => {
    const d = await device();
    await signIn(d, 'suspend-account@example.com');
    const deps = makeDeps('2025-01-01T06:00:00.000Z', d.installationId);
    await setupAccount(deps, { operationId: randomUUID(), accountName: 'Account Suspended', phoneNumber: '0712000011', openingBalance: 1_000, pin: PIN });
    await syncOutbox(deps, d.transport);
    const accountId = (await deps.store.getAccount())!.id;
    const suspensions = new SuspensionService(db);
    await suspensions.suspend('ACCOUNT', accountId, 'admin:test', 'Abuse of promotions');

    const refused = await d.call('GET', '/v1/sync/state');
    expect([refused.status, refused.body.error.code]).toEqual([403, 'ACCOUNT_SUSPENDED']);
    // the same email cannot sign in anywhere
    const other = await device();
    await db.query('DELETE FROM sign_in_codes WHERE email = $1', ['suspend-account@example.com']);
    const code = await other.call('POST', '/v1/auth/code', { email: 'suspend-account@example.com' });
    expect([code.status, code.body.error.code]).toEqual([403, 'ACCOUNT_SUSPENDED']);
    // the device can sign out and continue with another email
    expect((await d.call('POST', '/v1/auth/sign-out')).status).toBe(200);
    expect((await signIn(d, 'fresh-after-suspension@example.com')).status).toBe(200);
    expect((await d.call('GET', '/v1/sync/state')).status).toBe(200);

    // reinstated: the email signs in again and gets its account back
    await suspensions.reinstate('ACCOUNT', accountId, 'admin:test', '');
    const back = await signIn(other, 'suspend-account@example.com');
    expect(back.body.accountId).toBe(accountId);
  });
});
