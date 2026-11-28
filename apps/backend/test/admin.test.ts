/**
 * Back office (White Paper §34–35, §44.3): login and lockout, roles enforced on the server, CSRF,
 * escaping of user-supplied text, and audited changes. Runs the real app over HTTP against PGlite.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app.js';
import { AdminAuth, hashPassword, verifyPassword } from '../src/admin/auth.js';
import { openDatabase, type Database } from '../src/database.js';
import { html } from '../src/admin/views.js';
import { MonetizationService } from '../src/monetization.service.js';
import { base32Decode, base32Encode, currentStep, totpAt, verifyTotp } from '../src/admin/totp.js';

let db: Database;
let app: INestApplication;
let base: string;
const PASSWORD = 'correct horse 42';

beforeAll(async () => {
  db = await openDatabase({});
  const auth = new AdminAuth(db);
  await auth.createAdmin({ email: 'boss@example.com', name: 'Boss', role: 'ADMIN', password: PASSWORD }, 'test');
  await auth.createAdmin({ email: 'ops@example.com', name: 'Ops', role: 'OPERATOR', password: PASSWORD }, 'test');
  await auth.createAdmin({ email: 'look@example.com', name: 'Looker', role: 'VIEWER', password: PASSWORD }, 'test');
  await auth.createAdmin({ email: 'lockme@example.com', name: 'Lock', role: 'VIEWER', password: PASSWORD }, 'test');
  app = await createApp(db);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const form = (data: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString(),
  redirect: 'manual' as const,
});

/** Signs in and returns a client that sends the session cookie and knows the CSRF token. */
async function signIn(email: string) {
  const res = await fetch(`${base}/admin/login`, form({ email, password: PASSWORD }));
  expect(res.status).toBe(303);
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  const get = (path: string) => fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual' });
  const page = await (await get('/admin')).text();
  const csrf = /name="_csrf" value="([0-9a-f]+)"/.exec(page)![1]!;
  const post = (path: string, data: Record<string, string>, withCsrf = true) => {
    const f = form(withCsrf ? { _csrf: csrf, ...data } : data);
    return fetch(`${base}${path}`, { ...f, headers: { ...f.headers, cookie } });
  };
  return { cookie, csrf, get, post };
}

async function newAccount(name = 'Amina Wanjiru') {
  const installationId = randomUUID();
  const accountId = randomUUID();
  await db.query("INSERT INTO installations (id, token_hash, platform) VALUES ($1, $2, 'android')", [installationId, randomUUID()]);
  await db.query(
    `INSERT INTO accounts (id, installation_id, account_name, phone_number, opening_balance, balance, version, currency, created_at, updated_at)
     VALUES ($1, $2, $3, '254798765432', 1000, 1000, 1, 'KES', now(), now())`,
    [accountId, installationId, name],
  );
  return { accountId, installationId };
}

describe('back office', () => {
  it('stores passwords as salted scrypt hashes', async () => {
    const h = await hashPassword(PASSWORD);
    expect(h).toMatch(/^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(h).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, h)).toBe(true);
    expect(await verifyPassword('wrong password 1', h)).toBe(false);
  });

  it('redirects to the login page without a session, and sets strict security headers', async () => {
    const res = await fetch(`${base}/admin/accounts`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/login');
    const login = await fetch(`${base}/admin/login`);
    expect(login.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(login.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(login.headers.get('content-security-policy')).not.toContain('unsafe-inline');
    expect(await login.text()).toMatch(/class="secondary pw-toggle" data-for="password"[^>]*hidden>Show</);
    expect((await fetch(`${base}/admin/assets/admin.js`)).headers.get('content-type')).toMatch(/javascript/);
    expect(login.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(login.headers.get('x-powered-by')).toBeNull();
  });

  it('signs in with an HttpOnly, SameSite=Strict cookie, and signs out', async () => {
    const res = await fetch(`${base}/admin/login`, form({ email: 'BOSS@example.com ', password: PASSWORD }));
    expect(res.headers.get('set-cookie')).toMatch(/paspesa_admin=[0-9a-f]{64}; Path=\/admin; HttpOnly; SameSite=Strict/);
    const c = await signIn('boss@example.com');
    expect((await c.get('/admin')).status).toBe(200);
    expect((await c.post('/admin/logout', {})).status).toBe(303);
    expect((await c.get('/admin')).status).toBe(303); // session gone
  });

  it('gives the same answer for an unknown email and a wrong password, and locks after 5 failures', async () => {
    const unknown = await fetch(`${base}/admin/login`, form({ email: 'nobody@example.com', password: 'x' }));
    const wrong = await fetch(`${base}/admin/login`, form({ email: 'lockme@example.com', password: 'x' }));
    expect(unknown.headers.get('location')).toBe(wrong.headers.get('location'));
    for (let i = 0; i < 4; i++) await fetch(`${base}/admin/login`, form({ email: 'lockme@example.com', password: 'x' }));
    const locked = await fetch(`${base}/admin/login`, form({ email: 'lockme@example.com', password: PASSWORD }));
    expect(decodeURIComponent(locked.headers.get('location')!)).toMatch(/Too many attempts/);
  });

  it('refuses a form without the session CSRF token', async () => {
    const { accountId } = await newAccount();
    const c = await signIn('boss@example.com');
    const res = await c.post(`/admin/accounts/${accountId}/grant`, { category: 'PROMOTIONAL', quantity: '10', reason: 'x', reference: 'csrf:1' }, false);
    expect(res.status).toBe(403);
    const forged = await c.post(`/admin/accounts/${accountId}/grant`, { _csrf: 'f'.repeat(48), category: 'PROMOTIONAL', quantity: '10', reason: 'x', reference: 'csrf:2' }, false);
    expect(forged.status).toBe(403);
    expect((await db.query("SELECT 1 FROM token_ledger WHERE reference_id LIKE 'csrf:%'")).length).toBe(0);
  });

  it('enforces roles on the server: viewers read only, operators cannot grant admin tokens or change settings', async () => {
    const { accountId } = await newAccount();
    const viewer = await signIn('look@example.com');
    expect((await viewer.get(`/admin/accounts/${accountId}`)).status).toBe(200);
    expect((await viewer.post(`/admin/accounts/${accountId}/grant`, { category: 'PROMOTIONAL', quantity: '5', reason: 'x', reference: 'role:1' })).status).toBe(403);
    expect((await viewer.get('/admin/users')).status).toBe(403);

    const ops = await signIn('ops@example.com');
    expect((await ops.post(`/admin/accounts/${accountId}/grant`, { category: 'ADMIN', quantity: '5', reason: 'x', reference: 'role:2' })).status).toBe(403);
    expect((await ops.post('/admin/settings', { paymentRequired: 'true', shillingsPerToken: '1', minimumPurchase: '10', offlineAuthorizationDays: '3' })).status).toBe(403);
    expect((await ops.post('/admin/users', { email: 'x@example.com', name: 'X', role: 'ADMIN', password: PASSWORD })).status).toBe(403);
    const ok = await ops.post(`/admin/accounts/${accountId}/grant`, { category: 'PROMOTIONAL', quantity: '5', reason: 'Launch promo', reference: 'role:3' });
    expect(ok.status).toBe(303);
    const [audit] = await db.query<{ actor_id: string; reason: string }>("SELECT actor_id, reason FROM audit_log WHERE action = 'GRANT_PROMOTIONAL_TOKENS' AND entity_id = $1", [accountId]);
    expect(audit).toMatchObject({ actor_id: 'admin:ops@example.com', reason: 'Launch promo' });
  });

  it('suspends and reinstates an account and a device; viewers cannot; the pages show it', async () => {
    const { accountId } = await newAccount();
    const [acct] = await db.query<{ installation_id: string }>('SELECT installation_id FROM accounts WHERE id = $1', [accountId]);
    const viewer = await signIn('look@example.com');
    expect((await viewer.post(`/admin/accounts/${accountId}/suspend`, { reason: 'x' })).status).toBe(403);
    const ops = await signIn('ops@example.com');
    expect((await ops.post(`/admin/accounts/${accountId}/suspend`, { reason: '' })).status).toBe(303); // refused: no reason
    expect((await db.query('SELECT 1 FROM accounts WHERE id = $1 AND suspended_at IS NOT NULL', [accountId])).length).toBe(0);
    expect((await ops.post(`/admin/accounts/${accountId}/suspend`, { reason: 'Abuse of promotions' })).status).toBe(303);
    const page = await (await ops.get(`/admin/accounts/${accountId}`)).text();
    expect(page).toContain('SUSPENDED');
    expect(page).toContain('Abuse of promotions');
    expect(page).toContain('Reinstate account');
    expect(await (await ops.get('/admin/accounts')).text()).toContain('SUSPENDED');
    expect((await ops.post(`/admin/accounts/${accountId}/reinstate`, { reason: 'Appealed' })).status).toBe(303);
    expect((await db.query('SELECT 1 FROM accounts WHERE id = $1 AND suspended_at IS NULL', [accountId])).length).toBe(1);

    expect((await ops.post(`/admin/devices/${acct!.installation_id}/suspend`, { reason: 'Shared phone' })).status).toBe(303);
    const devices = await (await ops.get('/admin/devices')).text();
    expect(devices).toContain('Shared phone');
    expect(devices).toContain('Reinstate device');
    expect((await ops.post(`/admin/devices/${acct!.installation_id}/reinstate`, {})).status).toBe(303);
    const audit = await db.query<{ action: string; actor_id: string }>("SELECT action, actor_id FROM audit_log WHERE entity_id IN ($1, $2) AND action LIKE '%STATE%' OR (entity_id IN ($1, $2) AND action LIKE 'SUSPEND%') ORDER BY id", [accountId, acct!.installation_id]);
    expect(audit.map((a) => a.action)).toEqual(['SUSPEND_ACCOUNT', 'REINSTATE_ACCOUNT', 'SUSPEND_DEVICE', 'REINSTATE_DEVICE']);
    expect(audit.every((a) => a.actor_id === 'admin:ops@example.com')).toBe(true);
  });

  it('fees are edited on the Fees page: a new version for admins only, with clear errors', async () => {
    const viewer = await signIn('look@example.com');
    const boss = await signIn('boss@example.com');
    const page = await (await boss.get('/admin/fees')).text();
    expect(page).toContain('action="/admin/fees/AGENT_WITHDRAWAL"');
    const { FeeService } = await import('../src/fees.service.js');
    const current = (await new FeeService(db).current()).find((x) => x.id === 'AGENT_WITHDRAWAL')!;
    const form: Record<string, string> = {};
    current.bands.forEach((band, i) => { form[`min_${i}`] = String(band.min); form[`max_${i}`] = String(band.max); form[`fee_${i}`] = String(i === 0 ? band.fee + 1 : band.fee); });
    expect((await viewer.post('/admin/fees/AGENT_WITHDRAWAL', form)).status).toBe(403);
    expect((await boss.post('/admin/fees/AGENT_WITHDRAWAL', { ...form, fee_0: 'ten' })).status).toBe(303); // refused: not a number
    expect((await new FeeService(db).current()).find((x) => x.id === 'AGENT_WITHDRAWAL')!.version).toBe(current.version);
    expect((await boss.post('/admin/fees/AGENT_WITHDRAWAL', form)).status).toBe(303);
    const after = (await new FeeService(db).current()).find((x) => x.id === 'AGENT_WITHDRAWAL')!;
    expect(after.version).toBe(current.version + 1);
    expect(after.bands[0]!.fee).toBe(current.bands[0]!.fee + 1);
  });

  it('when 2-step sign-in is required, an admin without it can only reach My account', async () => {
    const c = await signIn('look@example.com');
    process.env.ADMIN_REQUIRE_2FA = 'true';
    try {
      const res = await c.get('/admin/accounts');
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toMatch(/^\/admin\/me\?err=/);
      expect((await c.get('/admin/me')).status).toBe(200);
    } finally {
      delete process.env.ADMIN_REQUIRE_2FA;
    }
    expect((await c.get('/admin/accounts')).status).toBe(200);
  });

  it('grants are idempotent per form submission', async () => {
    const { accountId } = await newAccount();
    const c = await signIn('boss@example.com');
    for (let i = 0; i < 2; i++) await c.post(`/admin/accounts/${accountId}/grant`, { category: 'ADMIN', quantity: '30', reason: 'Support', reference: 'admin:same-form' });
    const page = await (await c.get(`/admin/accounts/${accountId}`)).text();
    expect(page).toContain('Available</th><td>30 ');
  });

  it('escapes user-supplied text (account names come from phones)', async () => {
    await newAccount('<script>alert(1)</script>');
    const c = await signIn('look@example.com');
    const page = await (await c.get('/admin/accounts?q=script')).text();
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html`<b>${'"><img src=x onerror=1>'}</b>`.value).toBe('<b>&quot;&gt;&lt;img src=x onerror=1&gt;</b>');
  });

  it('administrators change settings and publish pricing, both audited', async () => {
    const c = await signIn('boss@example.com');
    const saved = await c.post('/admin/settings', { paymentRequired: 'true', freeSimulationsOffline: 'true', shillingsPerToken: '1', minimumPurchase: '10', offlineAuthorizationDays: '5' });
    expect(saved.status).toBe(303);
    expect(await new MonetizationService(db).settings()).toMatchObject({ paymentRequired: true, offlineAuthorizationDays: 5 });

    const bad = await c.post('/admin/pricing', { id: 'global-paybill', scopeType: 'GLOBAL', transactionType: 'PAYBILL', formula: 'TIERED', freeThreshold: '0', tiers: 'nonsense', status: 'ACTIVE' });
    expect(decodeURIComponent(bad.headers.get('location')!)).toMatch(/err=Cannot read tier/);
    const good = await c.post('/admin/pricing', { id: 'global-paybill', scopeType: 'GLOBAL', transactionType: 'PAYBILL', formula: 'TIERED', freeThreshold: '20', tiers: '0-20:0\n21-100:3\n101-:8', status: 'ACTIVE' });
    expect(decodeURIComponent(good.headers.get('location')!)).toMatch(/ok=Published global-paybill v1/);
    expect((await (await c.get('/admin/pricing')).text())).toContain('21–100: 3');
    // the calculator uses the rules in force (here the new Paybill ranges), rendered on the server (no inline script)
    const calc = await (await c.get('/admin/calculator?type=PAYBILL&amount=50&tokens=8')).text();
    expect(calc).toContain('costs <strong>3 tokens</strong>');
    expect(calc).toContain('up to <strong>KSh 250,000</strong>');
    expect(calc).not.toMatch(/<script>|style="/);
    expect(await (await c.get('/admin/settings')).text()).not.toMatch(/style="/);
    const actions = (await db.query<{ action: string }>("SELECT action FROM audit_log WHERE actor_id = 'admin:boss@example.com'")).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['UPDATE_MONETIZATION_SETTINGS']));
  });

  it('the review queue explains each item and offers Apply only when it still fits the ledger', async () => {
    const { accountId, installationId } = await newAccount();
    const t = { id: randomUUID(), accountId, operationId: randomUUID(), sequence: 2, type: 'SEND_MONEY', amount: 50, balanceBefore: 1000, balanceAfter: 950, completedAt: new Date().toISOString(), paymentMethod: 'UNMETERED' };
    await db.query('UPDATE installations SET account_id = $2 WHERE id = $1', [installationId, accountId]);
    await db.query(
      `INSERT INTO sync_review (installation_id, operation_id, entity_type, operation_type, code, message, payload) VALUES ($1, $2, 'TRANSACTION', 'CREATE_SIMULATION', 'PAYMENT_REQUIRED', 'This simulation costs 10 tokens', $3)`,
      [installationId, t.operationId, JSON.stringify({ transaction: t, message: null })],
    );
    const ops = await signIn('ops@example.com');
    const page = await (await ops.get('/admin/review')).text();
    expect(page).toContain('Needed payment');
    expect(page).toContain('It still fits the ledger');
    expect(page).toMatch(/action="\/admin\/review\/\d+\/apply"/);
    const viewer = await signIn('look@example.com');
    expect(await (await viewer.get('/admin/review')).text()).not.toMatch(/\/apply"/); // viewers can't act
  });

  it('every page renders for a signed-in viewer', async () => {
    const c = await signIn('look@example.com');
    for (const p of ['/admin', '/admin/reports', '/admin/reports?days=7', '/admin/accounts', '/admin/devices', '/admin/payments', '/admin/review', '/admin/pricing', '/admin/fees', '/admin/settings', '/admin/audit']) {
      const res = await c.get(p);
      expect(res.status, p).toBe(200);
    }
    // the report counts this suite's simulations; its CSV has one line per day
    const report = await (await c.get('/admin/reports?days=7')).text();
    expect(report).toContain('Simulations per day');
    const csv = await c.get('/admin/reports.csv?days=7');
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    expect((await csv.text()).trim().split(/\r?\n/)).toHaveLength(8);
    expect((await fetch(`${base}/admin/assets/admin.css`)).headers.get('content-type')).toMatch(/text\/css/);
  });

  it('administrators add and disable admin users; a disabled user is signed out', async () => {
    const boss = await signIn('boss@example.com');
    expect((await boss.post('/admin/users', { email: 'temp@example.com', name: 'Temp', role: 'OPERATOR', password: 'short' })).headers.get('location')).toMatch(/err=/);
    expect((await boss.post('/admin/users', { email: 'temp@example.com', name: 'Temp', role: 'OPERATOR', password: PASSWORD })).headers.get('location')).toMatch(/ok=/);
    const temp = await signIn('temp@example.com');
    const [u] = await db.query<{ id: string }>("SELECT id FROM admin_users WHERE email = 'temp@example.com'");
    await boss.post(`/admin/users/${u!.id}/disable`, {});
    expect((await temp.get('/admin')).status).toBe(303);
  });
});

describe('authenticator codes (TOTP)', () => {
  it('matches the RFC 6238 test vector and allows one step of drift', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpAt(secret, Math.floor(59 / 30))).toBe('287082'); // RFC 6238, T=59s, SHA-1, 6 digits
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    const now = Date.now();
    expect(verifyTotp(secret, totpAt(secret, currentStep(now) - 1), now)).toBe(currentStep(now) - 1);
    expect(verifyTotp(secret, totpAt(secret, currentStep(now) - 3), now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, currentStep(now)), now, currentStep(now))).toBeNull(); // no reuse
  });
});

describe('my account', () => {
  const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!;
  const loc = (res: Response) => decodeURIComponent(res.headers.get('location') ?? '');

  it('turns on 2-step sign-in; sign-in then needs the app code or a recovery code (once each)', async () => {
    await new AdminAuth(db).createAdmin({ email: 'twofa@example.com', name: 'Two Fa', role: 'OPERATOR', password: PASSWORD }, 'test');
    const c = await signIn('twofa@example.com');
    expect((await c.get('/admin/me')).status).toBe(200);
    expect((await c.post('/admin/me/2fa/start', {})).headers.get('location')).toBe('/admin/me/2fa');
    const setup = await (await c.get('/admin/me/2fa')).text();
    expect(setup).toContain('<svg'); // QR code, inline
    const [{ totp_pending_secret: secret }] = await db.query<{ totp_pending_secret: string }>("SELECT totp_pending_secret FROM admin_users WHERE email = 'twofa@example.com'") as [{ totp_pending_secret: string }];
    expect(setup).toContain(secret.slice(0, 4));
    expect(loc(await c.post('/admin/me/2fa/confirm', { code: '000000' === totpAt(secret, currentStep()) ? '111111' : '000000' }))).toMatch(/err=That code did not match/);
    const shown = await (await c.post('/admin/me/2fa/confirm', { code: totpAt(secret, currentStep()) })).text();
    const codes = [...shown.matchAll(/<code>([a-z0-9]{4}-[a-z0-9]{4})<\/code>/g)].map((m) => m[1]!);
    expect(codes).toHaveLength(10);
    const [stored] = await db.query<{ recovery_codes: string[] }>("SELECT recovery_codes FROM admin_users WHERE email = 'twofa@example.com'");
    expect(JSON.stringify(stored!.recovery_codes)).not.toContain(codes[0]!); // hashes only

    // password alone no longer signs in
    const step1 = await fetch(`${base}/admin/login`, form({ email: 'twofa@example.com', password: PASSWORD }));
    expect(step1.headers.get('location')).toBe('/admin/login/code');
    const pending = cookieOf(step1);
    expect(pending).toMatch(/^paspesa_admin_2fa=/);
    const codeForm = (code: string) => { const f = form({ code }); return fetch(`${base}/admin/login/code`, { ...f, headers: { ...f.headers, cookie: pending } }); };
    expect(loc(await codeForm('123'))).toMatch(/err=Wrong code/);
    const ok = await codeForm(totpAt(secret, currentStep() + 1)); // the next code (the current one was used to confirm)
    expect(ok.headers.get('location')).toBe('/admin');
    expect(ok.headers.get('set-cookie')).toContain('paspesa_admin=');
    // the same form sent a second time (autofill plus Continue): already signed in → dashboard, not "Sign in again"
    const session = /paspesa_admin=[^;]+/.exec(ok.headers.get('set-cookie')!)![0];
    const dup = form({ code: totpAt(secret, currentStep() + 1) });
    const second = await fetch(`${base}/admin/login/code`, { ...dup, headers: { ...dup.headers, cookie: `${pending}; ${session}` } });
    expect(second.headers.get('location')).toBe('/admin');
    // and the sign-in pages send a signed-in admin to the dashboard
    for (const path of ['/admin/login', '/admin/login/code']) {
      expect((await fetch(`${base}${path}`, { redirect: 'manual', headers: { cookie: session } })).headers.get('location')).toBe('/admin');
    }

    // a recovery code works once
    const again = await fetch(`${base}/admin/login`, form({ email: 'twofa@example.com', password: PASSWORD }));
    const p2 = cookieOf(again);
    const useCode = (code: string) => { const f = form({ code }); return fetch(`${base}/admin/login/code`, { ...f, headers: { ...f.headers, cookie: p2 } }); };
    expect((await useCode(codes[0]!.toUpperCase())).headers.get('location')).toBe('/admin');
    const again2 = await fetch(`${base}/admin/login`, form({ email: 'twofa@example.com', password: PASSWORD }));
    const f3 = form({ code: codes[0]! });
    expect(loc(await fetch(`${base}/admin/login/code`, { ...f3, headers: { ...f3.headers, cookie: cookieOf(again2) } }))).toMatch(/err=Wrong code/);

    // an administrator can reset it (lost phone and codes)
    const boss = await signIn('boss@example.com');
    const [u] = await db.query<{ id: string }>("SELECT id FROM admin_users WHERE email = 'twofa@example.com'");
    await boss.post(`/admin/users/${u!.id}/reset-2fa`, {});
    expect((await fetch(`${base}/admin/login`, form({ email: 'twofa@example.com', password: PASSWORD }))).headers.get('location')).toBe('/admin');
    const actions = (await db.query<{ action: string }>('SELECT action FROM audit_log WHERE entity_id = $1', [u!.id])).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['ENABLE_2FA', 'USED_RECOVERY_CODE', 'RESET_2FA']));
  });

  it('changes name and password; a new password signs out other sessions', async () => {
    await new AdminAuth(db).createAdmin({ email: 'pw@example.com', name: 'Pee Double', role: 'VIEWER', password: PASSWORD }, 'test');
    const here = await signIn('pw@example.com');
    const elsewhere = await signIn('pw@example.com');
    expect(loc(await here.post('/admin/me/name', { name: 'Peter W' }))).toMatch(/ok=Name saved/);
    expect(loc(await here.post('/admin/me/password', { current: 'wrong one 99', next: 'brand new pass 7', again: 'brand new pass 7' }))).toMatch(/err=Your current password is wrong/);
    expect(loc(await here.post('/admin/me/password', { current: PASSWORD, next: 'brand new pass 7', again: 'different 7777' }))).toMatch(/err=The two new passwords are different/);
    expect(loc(await here.post('/admin/me/password', { current: PASSWORD, next: 'brand new pass 7', again: 'brand new pass 7' }))).toMatch(/ok=Password changed/);
    expect((await here.get('/admin/me')).status).toBe(200);
    expect((await elsewhere.get('/admin/me')).status).toBe(303); // signed out
    const page = await (await here.get('/admin/me')).text();
    expect(page).toContain('Peter W');
    expect((await fetch(`${base}/admin/login`, form({ email: 'pw@example.com', password: 'brand new pass 7' }))).headers.get('location')).toBe('/admin');
  });
});
