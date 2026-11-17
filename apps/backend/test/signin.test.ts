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
  type AccountSnapshot,
  type EngineDeps,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncTransport,
} from '@paspesa/core';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';
import { memoryMailer } from '../src/mailer.js';

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
  processSimulation(deps, { operationId: randomUUID(), type: 'SEND_MONEY', amount, counterparty: { phone: '0706573273', name: 'Getrude Ohanga' }, pin: PIN });

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
    const created = await setupAccount(deps, { operationId: randomUUID(), accountName: 'Achieng Odhiambo', phoneNumber: '0712345678', openingBalance: 5_000, pin: PIN });
    expect(created.ok).toBe(true);
    expect((await syncOutbox(deps, d.transport)).error).toBeNull();
    const [acct] = await db.query<{ email: string }>('SELECT u.email FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.installation_id = $1', [d.installationId]);
    expect(acct!.email).toBe('achieng@example.com');
  });

  it('moves the account to a new device, restores it there, and signs the old device out', async () => {
    // Phone A: account, signed in, some simulations synced
    const a = await device();
    const depsA = makeDeps('2025-01-01T06:00:00.000Z', a.installationId);
    await setupAccount(depsA, { operationId: randomUUID(), accountName: 'Paskal Twoli', phoneNumber: '0759981287', openingBalance: 20_000, pin: PIN });
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

    // A uploads what it recorded before the move, and is told it was signed out
    const leftover = await syncOutbox(depsA, a.transport);
    expect(leftover.needsReview).toBe(0);
    const pushed = await a.call('POST', '/v1/sync/push', { apiVersion: 1, installationId: a.installationId, operations: [] });
    expect(pushed.body.signedOut).toBe(true);

    // B restores: same balance, same transactions, then creates its own PIN and continues
    const snap = (await b.call('GET', '/v1/account/restore')).body as AccountSnapshot;
    const state = stateFromSnapshot(snap, b.installationId);
    const accountA = (await depsA.store.getAccount())!;
    expect(state.account!.currentBalanceCache).toBe(accountA.currentBalanceCache);
    expect(state.transactions.map((t) => t.id).sort()).toEqual((await depsA.store.listTransactions()).map((t) => t.id).sort());
    expect(state.account!.pin).toBeNull(); // the PIN never leaves a device
    expect(state.messages.length).toBe(2);
    const depsB = makeDeps('2025-06-01T06:00:00.000Z', b.installationId, new MemoryStore(state));
    expect((await send(depsB, 100)).ok).toBe(false); // no PIN yet
    expect((await setPin(depsB, { newPin: PIN })).ok).toBe(true);
    expect((await send(depsB, 100)).ok).toBe(true);
    const fromB = await syncOutbox(depsB, b.transport);
    expect(fromB.needsReview).toBe(0);
    expect(fromB.server!.balance).toBe((await depsB.store.getAccount())!.currentBalanceCache);

    // Anything A records after the move is kept for review, never applied
    depsA.setTime('2031-01-01T00:00:00.000Z');
    await send(depsA, 50);
    const late = await syncOutbox(depsA, a.transport);
    expect(late.needsReview).toBe(1);
    const [review] = await db.query<{ code: string }>('SELECT code FROM sync_review WHERE installation_id = $1', [a.installationId]);
    expect(review!.code).toBe('SIGNED_OUT');
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
});
