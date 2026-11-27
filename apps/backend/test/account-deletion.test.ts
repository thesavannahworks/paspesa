/**
 * Deleting an account at its holder's request: confirmed by an emailed code (never a sign-in code), refused
 * while a payment is in progress, erases every personal trace, keeps real-money payment records without the
 * phone number, detaches every device, and leaves the email free to start over. Real app over HTTP, PGlite.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MemoryStore,
  addFavourite,
  processSimulation,
  setupAccount,
  syncOutbox,
  type EngineDeps,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncTransport,
} from '@paspesa/core';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';
import { memoryMailer } from '../src/mailer.js';
import { MonetizationService } from '../src/monetization.service.js';

let db: Database;
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
const mailer = memoryMailer();

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

async function device() {
  const installationId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  await fetch(`${base}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId, token }) });
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
  return { installationId, call, transport };
}

const lastCode = (email: string) => /(\d{6})/.exec([...mailer.sent].reverse().find((m) => m.to === email)!.subject)![1]!;

async function signIn(d: Awaited<ReturnType<typeof device>>, email: string) {
  await db.query('DELETE FROM sign_in_codes WHERE email = $1', [email]); // tests skip the one-a-minute wait
  expect((await d.call('POST', '/v1/auth/code', { email })).status).toBe(200);
  return d.call('POST', '/v1/auth/verify', { email, code: lastCode(email), termsVersion: '2026-11-27' });
}

function deps(installationId: string): EngineDeps {
  let t = Date.now() - 3_600_000;
  return {
    store: new MemoryStore(),
    config: DEFAULT_CONFIG,
    clock: { now: () => new Date((t += 1_000)).toISOString() },
    ids: { uuid: () => randomUUID() },
    random: { int: (max) => Math.floor(Math.random() * max) },
    pinHasher: { hash: async (pin, salt) => `h(${salt}:${pin})` },
    installationId,
  };
}

/** An account with a little of everything: transactions, a favourite, tokens, a payment, a held upload. */
async function busyAccount(email: string) {
  const d = await device();
  const signed = await signIn(d, email);
  expect(signed.status).toBe(200);
  const e = deps(d.installationId);
  await setupAccount(e, { operationId: randomUUID(), accountName: 'Amina Wanjiru', phoneNumber: '0798765432', openingBalance: 5_000, pin: '1234' });
  await processSimulation(e, { operationId: randomUUID(), type: 'SEND_MONEY', amount: 100, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, pin: '1234' });
  await addFavourite(e, { type: 'SEND_MONEY', counterparty: { phone: '0722000111', name: 'Peter Kamau' } });
  await syncOutbox(e, d.transport);
  const accountId = (await e.store.getAccount())!.id;
  await new MonetizationService(db).grant({ accountId, category: 'PROMOTIONAL', quantity: 25, reference: `promo:${randomUUID()}`, actor: 'test' });
  const paymentId = randomUUID();
  await db.query(
    `INSERT INTO payments (id, owner_id, payment_type, provider, provider_reference, idempotency_key, amount, currency, status, tokens, payer_phone, related_simulation_id, simulation_status, refund_status, created_at)
     VALUES ($1, $2, 'TOKEN_PURCHASE', 'payhero', $4, $3, 50, 'KES', 'SUCCESSFUL', 50, '254798765432', NULL, 'NOT_APPLICABLE', 'NONE', now())`,
    [paymentId, accountId, `key-${paymentId}`, `REF-${paymentId}`],
  );
  await db.query("INSERT INTO sync_review (installation_id, operation_id, entity_type, operation_type, code, message, payload) VALUES ($1, $2, 'TRANSACTION', 'CREATE_SIMULATION', 'BALANCE_MISMATCH', 'x', $3)", [
    d.installationId, randomUUID(), JSON.stringify({ transaction: { accountId, counterparty: { name: 'Peter Kamau', phone: '254722000111' } } }),
  ]);
  return { d, e, accountId, paymentId };
}

describe('account deletion', () => {
  it('needs an emailed deletion code: a sign-in code, a wrong code or a pending payment cannot delete', async () => {
    const email = `del-guard-${randomUUID().slice(0, 8)}@example.com`;
    const { d, accountId, paymentId } = await busyAccount(email);
    expect((await d.call('POST', '/v1/account/delete', { code: '123456' })).status).toBe(410); // no deletion code yet

    // a pending payment: refused before any code is sent
    await db.query("UPDATE payments SET status = 'PENDING' WHERE id = $1", [paymentId]);
    const pending = await d.call('POST', '/v1/account/delete/code');
    expect([pending.status, pending.body.error.code]).toEqual([409, 'PAYMENT_PENDING']);
    await db.query("UPDATE payments SET status = 'SUCCESSFUL' WHERE id = $1", [paymentId]);

    // a sign-in code is not a deletion code
    await db.query('DELETE FROM sign_in_codes WHERE email = $1', [email]);
    await d.call('POST', '/v1/auth/code', { email });
    const signInCode = lastCode(email);
    await db.query('UPDATE sign_in_codes SET created_at = created_at - interval \'2 minutes\' WHERE email = $1', [email]);
    const sent = await d.call('POST', '/v1/account/delete/code');
    expect(sent.status).toBe(200);
    expect(sent.body.email).toMatch(/^de\*+@example\.com$/); // masked
    const deletionCode = lastCode(email);
    expect(mailer.sent.at(-1)!.subject).toMatch(/delete your Paspesa account/);
    if (signInCode !== deletionCode) expect((await d.call('POST', '/v1/account/delete', { code: signInCode })).status).toBe(401);
    const wrong = await d.call('POST', '/v1/account/delete', { code: deletionCode === '000000' ? '111111' : '000000' });
    expect([wrong.status, wrong.body.error.code]).toEqual([401, 'WRONG_CODE']);
    const [account] = await db.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM accounts WHERE id = $1', [accountId]);
    expect(account!.deleted_at).toBeNull();
  });

  it('erases every personal trace, keeps the payment record without the phone, and frees the email', async () => {
    const email = `del-full-${randomUUID().slice(0, 8)}@example.com`;
    const { d, accountId, paymentId } = await busyAccount(email);
    const [user] = await db.query<{ id: string; terms_version: string }>('SELECT id, terms_version FROM users WHERE email = $1', [email]);
    expect(user!.terms_version).toBe('2026-11-27'); // consent was recorded at sign-in

    expect((await d.call('POST', '/v1/account/delete/code')).status).toBe(200);
    const done = await d.call('POST', '/v1/account/delete', { code: lastCode(email) });
    expect([done.status, done.body]).toEqual([200, { deleted: true }]);

    const count = async (sql: string, args: unknown[]) => Number((await db.query<{ n: string }>(sql, args))[0]!.n);
    expect(await count('SELECT count(*) AS n FROM transactions WHERE account_id = $1', [accountId])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM balance_movements WHERE account_id = $1', [accountId])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM messages WHERE account_id = $1', [accountId])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM favourites WHERE account_id = $1', [accountId])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM token_wallets WHERE owner_id = $1', [accountId])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM sync_review WHERE installation_id = $1', [d.installationId])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM sync_review WHERE payload::text LIKE $1", [`%${accountId}%`])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM users WHERE email = $1', [email])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM sign_in_codes WHERE email = $1', [email])).toBe(0);

    const [tomb] = await db.query<{ account_name: string; phone_number: string; user_id: string | null; installation_id: string | null; deleted_at: Date | null }>(
      'SELECT account_name, phone_number, user_id, installation_id, deleted_at FROM accounts WHERE id = $1', [accountId],
    );
    expect(tomb).toMatchObject({ account_name: 'Deleted account', phone_number: '', user_id: null, installation_id: null });
    expect(tomb!.deleted_at).not.toBeNull();
    const [payment] = await db.query<{ amount: string; payer_phone: string | null; provider_reference: string }>('SELECT amount, payer_phone, provider_reference FROM payments WHERE id = $1', [paymentId]);
    expect(payment).toMatchObject({ payer_phone: null, provider_reference: `REF-${paymentId}` });
    expect(Number(payment!.amount)).toBe(50);
    const [audit] = await db.query<{ actor_id: string }>("SELECT actor_id FROM audit_log WHERE action = 'DELETE_ACCOUNT' AND entity_id = $1", [accountId]);
    expect(audit!.actor_id).toBe(`installation:${d.installationId}`);

    // the device is detached; the same email starts a brand-new account
    const [dev] = await db.query<{ account_id: string | null; user_id: string | null }>('SELECT account_id, user_id FROM installations WHERE id = $1', [d.installationId]);
    expect(dev).toEqual({ account_id: null, user_id: null });
    const again = await signIn(d, email);
    expect([again.status, again.body.accountId]).toEqual([200, null]);
  });
});
