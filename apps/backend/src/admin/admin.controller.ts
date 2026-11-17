/**
 * Back office (White Paper §34–35) at /admin: server-rendered pages, session login, role permissions
 * enforced here on the server (§44.3), CSRF tokens on every form, every change written to the audit log.
 */
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { DEFAULT_CONFIG, validatePricingRule, type MonetizationSettings, type PricingRule, type PricingTier, type SimulationType } from '@paspesa/core';
import { AllocationService } from '../allocation.service.js';
import type { Database } from '../database.js';
import { MonetizationService } from '../monetization.service.js';
import type { PaymentProviders } from '../providers.js';
import { AdminAuth, can, clearCookie, readCookie, SESSION_COOKIE, sessionCookie, type AdminAction, type AdminRole, type AdminSession } from './auth.js';
import { ADMIN_CSS, ADMIN_JS, passwordField, csrf, esc, fmtDate, html, ksh, layout, notice, type Html } from './views.js';

export const ADMIN_DATABASE = Symbol('ADMIN_DATABASE');
export const ADMIN_PROVIDERS = Symbol('ADMIN_PROVIDERS');

interface Req {
  headers: Record<string, string | string[] | undefined>;
  secure?: boolean;
}
interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string | string[]): void;
  send(body: string): void;
  redirect(code: number, url: string): void;
}
type Form = Record<string, string | undefined>;

const SIM_TYPES: SimulationType[] = ['SEND_MONEY', 'POCHI', 'BUY_GOODS', 'PAYBILL', 'AIRTIME', 'WITHDRAW', 'RECHARGE'];
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

class Denied extends Error {}

@Controller('admin')
export class AdminController {
  private readonly auth: AdminAuth;
  private readonly money: MonetizationService;
  private readonly allocations: AllocationService;

  constructor(
    @Inject(ADMIN_DATABASE) private readonly db: Database,
    @Inject(ADMIN_PROVIDERS) private readonly providers: PaymentProviders,
  ) {
    this.auth = new AdminAuth(db);
    this.money = new MonetizationService(db);
    this.allocations = new AllocationService(db, this.money);
  }

  // ------------------------------------------------------------------------------------------ plumbing

  private send(res: Res, page: string, status = 200) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(status).send(page);
  }

  private back(res: Res, path: string, message?: string, error = false) {
    res.redirect(303, message ? `${path}${path.includes('?') ? '&' : '?'}${error ? 'err' : 'ok'}=${encodeURIComponent(message)}` : path);
  }

  /** The signed-in admin, or a redirect to the login page. */
  private async session(req: Req, res: Res): Promise<AdminSession | null> {
    const session = await this.auth.session(readCookie(req.headers.cookie as string | undefined, SESSION_COOKIE));
    if (!session) res.redirect(303, '/admin/login');
    return session;
  }

  /** For every change: valid CSRF token and the role's permission, checked on the server. */
  private guard(session: AdminSession, form: Form, action?: AdminAction) {
    if (!form?._csrf || form._csrf !== session.csrf) throw new Denied('Your session form expired. Reload the page and try again.');
    if (action && !can(session.admin.role, action)) throw new Denied('Your role does not allow this action.');
  }

  private denied(res: Res, session: AdminSession, e: unknown) {
    if (e instanceof Denied) return this.send(res, layout('Not allowed', session, html`<p class="notice error">${e.message}</p>`), 403);
    throw e;
  }

  private actor = (s: AdminSession) => `admin:${s.admin.email}`;

  private flash(q: { ok?: string; err?: string }) {
    return html`${notice(q.ok)}${notice(q.err, 'error')}`;
  }

  // ------------------------------------------------------------------------------------------ assets + login

  @Get('assets/admin.css')
  css(@Res() res: Res) {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'max-age=300');
    res.status(200).send(ADMIN_CSS);
  }

  /** The only script: show/hide on password fields. Served from here so inline scripts stay forbidden. */
  @Get('assets/admin.js')
  js(@Res() res: Res) {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(ADMIN_JS);
  }

  @Get('login')
  loginPage(@Res() res: Res, @Query('err') err?: string) {
    this.send(res, layout('Sign in', null, html`${notice(err, 'error')}
      <form method="post" action="/admin/login" class="panel">
        <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required>
        <label for="password">Password</label>${passwordField('password', 'password', 'current-password')}
        <button>Sign in</button>
      </form><p class="muted">Paspesa back office — authorised staff only.</p>`));
  }

  @Post('login')
  async login(@Body() form: Form, @Req() req: Req, @Res() res: Res) {
    const result = await this.auth.login(form?.email ?? '', form?.password ?? '');
    if (!result.ok) return this.back(res, '/admin/login', result.message, true);
    const secure = !!req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', sessionCookie(result.token, secure));
    res.redirect(303, '/admin');
  }

  @Post('logout')
  async logout(@Body() form: Form, @Req() req: Req, @Res() res: Res) {
    const session = await this.auth.session(readCookie(req.headers.cookie as string | undefined, SESSION_COOKIE));
    if (session && form?._csrf === session.csrf) await this.auth.logout(readCookie(req.headers.cookie as string | undefined, SESSION_COOKIE));
    res.setHeader('Set-Cookie', clearCookie());
    res.redirect(303, '/admin/login');
  }

  // ------------------------------------------------------------------------------------------ dashboard (§35.8)

  @Get()
  async dashboard(@Req() req: Req, @Res() res: Res) {
    const session = await this.session(req, res);
    if (!session) return;
    const one = async (sql: string, params: unknown[] = []) => Number(Object.values((await this.db.query<Record<string, unknown>>(sql, params))[0] ?? { v: 0 })[0] ?? 0);
    const dayStart = new Date(Date.now() + 3 * 3_600_000);
    dayStart.setUTCHours(0, 0, 0, 0);
    const todayEat = new Date(dayStart.getTime() - 3 * 3_600_000).toISOString();
    const stats: [string, string | number][] = [
      ['Accounts', await one('SELECT count(*) FROM accounts')],
      ['Active devices', await one("SELECT count(*) FROM installations WHERE status = 'ACTIVE'")],
      ['Simulations today', await one("SELECT count(*) FROM transactions WHERE type <> 'OPENING_BALANCE' AND completed_at >= $1", [todayEat])],
      ['Simulations (all)', await one("SELECT count(*) FROM transactions WHERE type <> 'OPENING_BALANCE'")],
      ['Token sales', ksh(await one("SELECT coalesce(sum(amount),0) FROM payments WHERE payment_type = 'TOKEN_PURCHASE' AND status = 'SUCCESSFUL'"))],
      ['Direct payments', ksh(await one("SELECT coalesce(sum(amount),0) FROM payments WHERE payment_type = 'DIRECT_SIMULATION' AND status = 'SUCCESSFUL'"))],
      ['Tokens spent (net)', await one("SELECT coalesce(sum(CASE WHEN entry_type = 'SIMULATION_EXPENDITURE' THEN quantity WHEN entry_type = 'EXPENDITURE_REVERSAL' THEN -quantity ELSE 0 END),0) FROM token_ledger")],
      ['Promotional granted', await one("SELECT coalesce(sum(quantity),0) FROM token_ledger WHERE entry_type = 'PROMOTIONAL_GRANT'")],
      ['Admin tokens granted', await one("SELECT coalesce(sum(quantity),0) FROM token_ledger WHERE entry_type = 'ADMIN_GRANT'")],
      ['Tokens on devices', await one('SELECT coalesce(sum(reserved_quantity),0) FROM token_lots')],
      ['Forfeited (lost devices)', await one("SELECT coalesce(sum(quantity),0) FROM token_ledger WHERE entry_type = 'LOST_DEVICE_FORFEITURE'")],
      ['Payments successful', await one("SELECT count(*) FROM payments WHERE status = 'SUCCESSFUL'")],
      ['Payments failed', await one("SELECT count(*) FROM payments WHERE status = 'FAILED'")],
      ['Payments waiting', await one("SELECT count(*) FROM payments WHERE status IN ('INITIATED','PENDING')")],
      ['Refundable credit owed', ksh(await one("SELECT coalesce(sum(amount),0) FROM payment_credits WHERE status = 'AVAILABLE'"))],
      ['Review items open', await one('SELECT count(*) FROM sync_review WHERE resolved_at IS NULL')],
    ];
    const settings = await this.money.settings();
    this.send(res, layout('Dashboard', session, html`
      <p class="muted">Payments are <b>${settings.paymentRequired ? 'ON' : 'OFF'}</b> · free simulations offline: <b>${settings.freeSimulationsOffline ? 'allowed' : 'not allowed'}</b> · payment providers: <b>${this.providers.all.map((p) => p.name).join(', ') || 'none configured'}</b></p>
      <div class="cards">${stats.map(([k, v]) => html`<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`)}</div>`, '/admin'));
  }

  // ------------------------------------------------------------------------------------------ accounts (§35.4–35.5)

  @Get('accounts')
  async accounts(@Req() req: Req, @Res() res: Res, @Query('q') q = '') {
    const session = await this.session(req, res);
    if (!session) return;
    const term = q.trim();
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT a.id, a.account_name, a.phone_number, a.balance, a.created_at, i.status AS device_status, coalesce(w.total_balance_cache, 0) AS tokens
       FROM accounts a JOIN installations i ON i.id = a.installation_id LEFT JOIN token_wallets w ON w.owner_id = a.id
       WHERE $1 = '' OR a.account_name ILIKE '%' || $1 || '%' OR a.phone_number LIKE '%' || $1 || '%' OR a.id = $1
       ORDER BY a.created_at DESC LIMIT 200`,
      [term],
    );
    this.send(res, layout('Accounts', session, html`
      <form method="get" class="panel"><label for="q">Search name, phone or account ID</label><input id="q" name="q" value="${term}"><button class="secondary">Search</button></form>
      <div class="panel"><table><tr><th>Name</th><th>Phone</th><th class="num">Balance</th><th class="num">Tokens</th><th>Device</th><th>Created</th></tr>
      ${rows.map((r) => html`<tr><td><a href="/admin/accounts/${r.id}">${r.account_name}</a></td><td>${r.phone_number}</td><td class="num">${ksh(r.balance)}</td><td class="num">${r.tokens}</td>
        <td><span class="pill ${r.device_status === 'ACTIVE' ? 'ok' : 'bad'}">${r.device_status}</span></td><td>${fmtDate(r.created_at)}</td></tr>`)}
      </table>${rows.length ? html`` : html`<p class="muted">No accounts.</p>`}</div>`, '/admin/accounts'));
  }

  @Get('accounts/:id')
  async account(@Req() req: Req, @Res() res: Res, @Param('id') id: string, @Query() q: { ok?: string; err?: string }) {
    const session = await this.session(req, res);
    if (!session) return;
    const [a] = await this.db.query<Record<string, unknown>>('SELECT a.*, i.platform, i.status AS device_status, i.last_seen_at FROM accounts a JOIN installations i ON i.id = a.installation_id WHERE a.id = $1', [id]);
    if (!a) return this.send(res, layout('Account not found', session, html`<p class="muted">No such account.</p>`), 404);
    const wallet = await this.money.wallet(id);
    const allocation = await this.allocations.current(String(a.installation_id));
    const txs = await this.db.query<Record<string, unknown>>('SELECT reference, type, amount, fee, balance_after, completed_at, record FROM transactions WHERE account_id = $1 ORDER BY sequence DESC LIMIT 40', [id]);
    const problems = await this.money.reconcile(id);
    const mayGrant = can(session.admin.role, 'GRANT_PROMOTIONAL');
    this.send(res, layout(String(a.account_name), session, html`${this.flash(q)}
      <div class="row">
        <div class="panel"><h2>Account</h2><table>
          <tr><th>Phone</th><td>${a.phone_number}</td></tr><tr><th>Simulated balance</th><td>${ksh(a.balance)}</td></tr>
          <tr><th>Opening balance</th><td>${ksh(a.opening_balance)}</td></tr><tr><th>Airtime</th><td>${ksh(a.airtime_balance)}</td></tr>
          <tr><th>Device</th><td>${a.platform ?? '—'} · <span class="pill ${a.device_status === 'ACTIVE' ? 'ok' : 'bad'}">${a.device_status}</span> · last seen ${fmtDate(a.last_seen_at)}</td></tr>
          <tr><th>Account ID</th><td class="muted">${a.id}</td></tr></table></div>
        <div class="panel"><h2>Token wallet</h2><table>
          <tr><th>Available</th><td>${wallet.balances.total} (purchased ${wallet.balances.PURCHASED} · promotional ${wallet.balances.PROMOTIONAL} · admin ${wallet.balances.ADMIN})</td></tr>
          <tr><th>On the device</th><td>${allocation ? `${allocation.remaining} left · authorized until ${fmtDate(allocation.authorizationExpiresAt)}` : 'none'}</td></tr>
          <tr><th>Reconciliation</th><td>${problems.length ? html`<span class="pill bad">${problems.length} problem(s)</span> ${problems.join('; ')}` : html`<span class="pill ok">consistent</span>`}</td></tr></table>
          ${mayGrant ? html`<form method="post" action="/admin/accounts/${id}/grant">${csrf(session)}<input type="hidden" name="reference" value="admin:${randomUUID()}">
            <label for="category">Grant tokens</label><select id="category" name="category"><option value="PROMOTIONAL">Promotional</option>
            ${can(session.admin.role, 'GRANT_ADMIN_TOKENS') ? html`<option value="ADMIN">Administrator-issued</option>` : html``}</select>
            <label for="qty">Quantity</label><input id="qty" name="quantity" type="number" min="1" required>
            <label for="exp">Expires (optional)</label><input id="exp" name="expiresAt" type="date">
            <label for="why">Reason</label><input id="why" name="reason" required maxlength="200">
            <button>Grant</button></form>` : html``}
        </div>
      </div>
      <div class="panel"><h2>Token ledger</h2><table><tr><th>When</th><th>Entry</th><th>Category</th><th class="num">Tokens</th><th>Reference</th></tr>
        ${wallet.ledger.map((e) => html`<tr><td>${fmtDate(e.at)}</td><td>${e.type}</td><td>${e.category}</td><td class="num">${e.direction === 'CREDIT' ? '+' : '−'}${e.quantity}</td><td class="muted">${e.reference}</td></tr>`)}
      </table></div>
      <div class="panel"><h2>Simulations (latest 40)</h2><table><tr><th>When</th><th>Reference</th><th>Type</th><th class="num">Amount</th><th class="num">Fee</th><th class="num">Balance after</th><th>Paid with</th></tr>
        ${txs.map((t) => html`<tr><td>${fmtDate(t.completed_at)}</td><td>${t.reference}</td><td>${t.type}</td><td class="num">${ksh(t.amount)}</td><td class="num">${ksh(t.fee)}</td><td class="num">${ksh(t.balance_after)}</td>
          <td>${(t.record as { paymentMethod?: string } | null)?.paymentMethod ?? ''}</td></tr>`)}
      </table></div>`, '/admin/accounts'));
  }

  @Post('accounts/:id/grant')
  async grant(@Req() req: Req, @Res() res: Res, @Param('id') id: string, @Body() form: Form) {
    const session = await this.session(req, res);
    if (!session) return;
    const category = form.category === 'ADMIN' ? 'ADMIN' : 'PROMOTIONAL';
    try {
      this.guard(session, form, category === 'ADMIN' ? 'GRANT_ADMIN_TOKENS' : 'GRANT_PROMOTIONAL');
    } catch (e) {
      return this.denied(res, session, e);
    }
    const quantity = Number(form.quantity);
    const reason = (form.reason ?? '').trim();
    if (!reason) return this.back(res, `/admin/accounts/${id}`, 'Give a reason for the grant', true);
    try {
      const r = await this.money.grant({
        accountId: id, category, quantity, reference: form.reference ?? `admin:${randomUUID()}`,
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59+03:00`).toISOString() : null, actor: this.actor(session),
      });
      await this.db.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6)', [
        this.actor(session), `GRANT_${category}_TOKENS`, 'ACCOUNT', id, JSON.stringify({ quantity, expiresAt: form.expiresAt || null }), reason,
      ]);
      this.back(res, `/admin/accounts/${id}`, r.duplicate ? 'That grant was already made (no change)' : `Granted ${quantity} ${category.toLowerCase()} tokens`);
    } catch (e) {
      this.back(res, `/admin/accounts/${id}`, e instanceof Error ? e.message : 'Grant failed', true);
    }
  }

  // ------------------------------------------------------------------------------------------ devices (§35.6)

  @Get('devices')
  async devices(@Req() req: Req, @Res() res: Res, @Query() q: { ok?: string; err?: string }) {
    const session = await this.session(req, res);
    if (!session) return;
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT i.id, i.platform, i.status, i.last_seen_at, a.id AS account_id, a.account_name,
              d.allocated_quantity, d.spent_quantity, d.released_quantity, d.forfeited_quantity, d.authorization_expires_at
       FROM installations i LEFT JOIN accounts a ON a.installation_id = i.id
       LEFT JOIN device_allocations d ON d.device_id = i.id AND d.status = 'ACTIVE' ORDER BY i.last_seen_at DESC NULLS LAST LIMIT 300`,
    );
    const history = await this.db.query<Record<string, unknown>>('SELECT device_id, status, allocated_quantity, spent_quantity, released_quantity, forfeited_quantity, created_at, released_at FROM device_allocations ORDER BY created_at DESC LIMIT 50');
    const mayMark = can(session.admin.role, 'MARK_DEVICE_LOST');
    this.send(res, layout('Devices', session, html`${this.flash(q)}
      <div class="panel"><table><tr><th>Device</th><th>Account</th><th>Status</th><th>Last seen</th><th class="num">On device</th><th>Authorized until</th><th></th></tr>
      ${rows.map((r) => {
        const left = r.allocated_quantity === null ? null : Number(r.allocated_quantity) - Number(r.spent_quantity) - Number(r.released_quantity) - Number(r.forfeited_quantity);
        return html`<tr><td>${r.platform ?? '—'}<div class="muted">${String(r.id).slice(0, 8)}…</div></td>
          <td>${r.account_id ? html`<a href="/admin/accounts/${r.account_id}">${r.account_name}</a>` : html`<span class="muted">not synced</span>`}</td>
          <td><span class="pill ${r.status === 'ACTIVE' ? 'ok' : 'bad'}">${r.status}</span></td><td>${fmtDate(r.last_seen_at)}</td>
          <td class="num">${left ?? '—'}</td><td>${r.authorization_expires_at ? fmtDate(r.authorization_expires_at) : '—'}</td>
          <td>${mayMark && r.status === 'ACTIVE' ? html`<details><summary>Mark lost</summary><form method="post" action="/admin/devices/${r.id}/lost">${csrf(session)}
            <label>Reason</label><input name="reason" required maxlength="200"><label><input type="checkbox" name="confirm" value="yes" required class="check"> The phone is permanently lost; its unreconciled tokens will be forfeited</label>
            <button class="danger">Forfeit and mark lost</button></form></details>` : html``}</td></tr>`;
      })}</table></div>
      <div class="panel"><h2>Allocation history</h2><table><tr><th>Device</th><th>Status</th><th class="num">Allocated</th><th class="num">Spent</th><th class="num">Returned</th><th class="num">Forfeited</th><th>Created</th><th>Closed</th></tr>
      ${history.map((h) => html`<tr><td class="muted">${String(h.device_id).slice(0, 8)}…</td><td>${h.status}</td><td class="num">${h.allocated_quantity}</td><td class="num">${h.spent_quantity}</td><td class="num">${h.released_quantity}</td><td class="num">${h.forfeited_quantity}</td><td>${fmtDate(h.created_at)}</td><td>${fmtDate(h.released_at)}</td></tr>`)}
      </table></div>`, '/admin/devices'));
  }

  @Post('devices/:id/lost')
  async lost(@Req() req: Req, @Res() res: Res, @Param('id') id: string, @Body() form: Form) {
    const session = await this.session(req, res);
    if (!session) return;
    try {
      this.guard(session, form, 'MARK_DEVICE_LOST');
    } catch (e) {
      return this.denied(res, session, e);
    }
    if (form.confirm !== 'yes' || !(form.reason ?? '').trim()) return this.back(res, '/admin/devices', 'Confirm and give a reason', true);
    const r = await this.allocations.forfeitLostDevice(id, this.actor(session), form.reason!.trim());
    this.back(res, '/admin/devices', `Device marked lost; ${r.forfeited} tokens forfeited`);
  }

  // ------------------------------------------------------------------------------------------ payments (§35.7)

  @Get('payments')
  async payments(@Req() req: Req, @Res() res: Res, @Query() q: { ok?: string; err?: string; status?: string }) {
    const session = await this.session(req, res);
    if (!session) return;
    const status = ['INITIATED', 'PENDING', 'SUCCESSFUL', 'FAILED'].includes(q.status ?? '') ? q.status! : '';
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT p.*, a.account_name FROM payments p JOIN accounts a ON a.id = p.owner_id WHERE $1 = '' OR p.status = $1 ORDER BY p.created_at DESC LIMIT 300`,
      [status],
    );
    const credits = await this.db.query<Record<string, unknown>>('SELECT c.*, a.account_name FROM payment_credits c JOIN accounts a ON a.id = c.owner_id ORDER BY c.created_at DESC LIMIT 100');
    const mayVerify = can(session.admin.role, 'VERIFY_PAYMENT');
    this.send(res, layout('Payments', session, html`${this.flash(q)}
      <form method="get" class="panel"><label for="status">Status</label><select id="status" name="status">
        ${['', 'INITIATED', 'PENDING', 'SUCCESSFUL', 'FAILED'].map((s) => html`<option value="${s}" ${s === status ? html`selected` : html``}>${s || 'All'}</option>`)}</select><button class="secondary">Filter</button></form>
      <div class="panel"><table><tr><th>When</th><th>Account</th><th>Type</th><th>Provider</th><th class="num">KSh</th><th class="num">Tokens</th><th>Payment</th><th>Simulation</th><th>Refund</th><th></th></tr>
      ${rows.map((p) => html`<tr><td>${fmtDate(p.created_at)}</td><td><a href="/admin/accounts/${p.owner_id}">${p.account_name}</a></td><td>${p.payment_type}</td><td>${p.provider}</td>
        <td class="num">${p.amount}</td><td class="num">${p.tokens ?? '—'}</td>
        <td><span class="pill ${p.status === 'SUCCESSFUL' ? 'ok' : p.status === 'FAILED' ? 'bad' : ''}">${p.status}</span></td><td>${p.simulation_status}</td><td>${p.refund_status}</td>
        <td>${mayVerify && (p.status === 'PENDING' || p.status === 'INITIATED') ? html`<form method="post" action="/admin/payments/${p.id}/verify" class="inline">${csrf(session)}<button class="secondary">Verify now</button></form>` : html``}</td></tr>`)}
      </table></div>
      <div class="panel"><h2>Refundable credits</h2><table><tr><th>When</th><th>Account</th><th class="num">KSh</th><th>Status</th><th>Payment</th></tr>
      ${credits.map((c) => html`<tr><td>${fmtDate(c.created_at)}</td><td>${c.account_name}</td><td class="num">${c.amount}</td><td>${c.status}</td><td class="muted">${c.payment_id}</td></tr>`)}
      </table></div>`, '/admin/payments'));
  }

  @Post('payments/:id/verify')
  async verify(@Req() req: Req, @Res() res: Res, @Param('id') id: string, @Body() form: Form) {
    const session = await this.session(req, res);
    if (!session) return;
    try {
      this.guard(session, form, 'VERIFY_PAYMENT');
    } catch (e) {
      return this.denied(res, session, e);
    }
    const [p] = await this.db.query<{ provider: string }>('SELECT provider FROM payments WHERE id = $1', [id]);
    const provider = p ? this.providers.byName(p.provider) : null;
    if (!provider) return this.back(res, '/admin/payments', 'That payment provider is not configured on this server', true);
    const after = await this.money.verifyPayment(id, provider);
    await this.db.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after_value) VALUES ($1, $2, $3, $4, $5)', [this.actor(session), 'VERIFY_PAYMENT', 'PAYMENT', id, JSON.stringify({ status: after.status })]);
    this.back(res, '/admin/payments', `Payment is ${after.status}`);
  }

  // ------------------------------------------------------------------------------------------ review queue (§24.4)

  @Get('review')
  async review(@Req() req: Req, @Res() res: Res, @Query() q: { ok?: string; err?: string }) {
    const session = await this.session(req, res);
    if (!session) return;
    const open = await this.db.query<Record<string, unknown>>('SELECT * FROM sync_review WHERE resolved_at IS NULL ORDER BY received_at DESC LIMIT 200');
    const closed = await this.db.query<Record<string, unknown>>('SELECT * FROM sync_review WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 50');
    const mayResolve = can(session.admin.role, 'RESOLVE_REVIEW');
    const item = (r: Record<string, unknown>, resolvable: boolean) => html`<tr><td>${fmtDate(r.received_at)}</td><td><span class="pill bad">${r.code}</span></td><td>${r.operation_type}</td><td>${r.message}</td>
      <td><details><summary>Payload</summary><pre>${JSON.stringify(r.payload, null, 2)}</pre></details></td>
      <td>${resolvable && mayResolve ? html`<form method="post" action="/admin/review/${r.id}/resolve">${csrf(session)}<input name="resolution" placeholder="What was done" required maxlength="300"><button class="secondary">Mark resolved</button></form>`
        : html`<span class="muted">${r.resolution ?? ''} ${r.resolved_by ? `(${r.resolved_by})` : ''}</span>`}</td></tr>`;
    this.send(res, layout('Review queue', session, html`${this.flash(q)}
      <p class="muted">Synced operations that failed the server's checks. Nothing here was applied to any balance; the records are kept for review (§24.4).</p>
      <div class="panel"><h2>Open (${open.length})</h2><table><tr><th>Received</th><th>Code</th><th>Operation</th><th>Detail</th><th></th><th></th></tr>${open.map((r) => item(r, true))}</table></div>
      <div class="panel"><h2>Resolved</h2><table><tr><th>Received</th><th>Code</th><th>Operation</th><th>Detail</th><th></th><th>Resolution</th></tr>${closed.map((r) => item(r, false))}</table></div>`, '/admin/review'));
  }

  @Post('review/:id/resolve')
  async resolve(@Req() req: Req, @Res() res: Res, @Param('id') id: string, @Body() form: Form) {
    const session = await this.session(req, res);
    if (!session) return;
    try {
      this.guard(session, form, 'RESOLVE_REVIEW');
    } catch (e) {
      return this.denied(res, session, e);
    }
    const resolution = (form.resolution ?? '').trim();
    if (!resolution) return this.back(res, '/admin/review', 'Describe what was done', true);
    await this.db.query('UPDATE sync_review SET resolved_at = now(), resolution = $2, resolved_by = $3 WHERE id = $1 AND resolved_at IS NULL', [id, resolution, this.actor(session)]);
    await this.db.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, reason) VALUES ($1, $2, $3, $4, $5)', [this.actor(session), 'RESOLVE_REVIEW', 'SYNC_REVIEW', id, resolution]);
    this.back(res, '/admin/review', 'Marked resolved');
  }

  // ------------------------------------------------------------------------------------------ pricing (§35.1)

  @Get('pricing')
  async pricing(@Req() req: Req, @Res() res: Res, @Query() q: { ok?: string; err?: string }) {
    const session = await this.session(req, res);
    if (!session) return;
    const config = await this.money.pricing();
    const tiers = (t: PricingTier[] | null) => (t ? t.map((x) => `${x.min}–${x.max ?? '∞'}: ${x.tokens}`).join(', ') : '—');
    const now = Date.now();
    const isCurrent = (r: PricingRule) => r.status === 'ACTIVE' && Date.parse(r.effectiveFrom) <= now && (!r.effectiveTo || Date.parse(r.effectiveTo) > now);
    const mayEdit = can(session.admin.role, 'EDIT_PRICING');
    this.send(res, layout('Pricing', session, html`${this.flash(q)}
      <p class="muted">Configuration version ${config.version}. Precedence: account + type → account → global type → global default. Changes create new versions; past simulations keep their price.</p>
      <div class="panel"><table><tr><th>Rule</th><th>Scope</th><th>Type</th><th>Formula</th><th class="num">Free up to</th><th class="num">KSh per token</th><th>Tiers</th><th>Effective</th><th>Status</th></tr>
      ${config.rules.map((r) => html`<tr><td>${r.id} <span class="muted">v${r.version}</span></td><td>${r.scopeType}${r.scopeId ? html` <a href="/admin/accounts/${r.scopeId}">account</a>` : html``}</td>
        <td>${r.transactionType ?? 'all'}</td><td>${r.formula}</td><td class="num">${r.freeThreshold}</td><td class="num">${r.amountPerToken ?? '—'}</td><td>${tiers(r.tiers)}</td>
        <td>${fmtDate(r.effectiveFrom)} → ${r.effectiveTo ? fmtDate(r.effectiveTo) : 'open'}</td><td><span class="pill ${isCurrent(r) ? 'ok' : ''}">${isCurrent(r) ? 'in force' : r.status}</span></td></tr>`)}
      </table></div>
      ${mayEdit ? html`<form method="post" action="/admin/pricing" class="panel">${csrf(session)}<h2>Publish a rule (new version)</h2>
        <div class="row"><div>
        <label for="rid">Rule ID</label><input id="rid" name="id" required value="global-default" pattern="[a-z0-9-]{3,40}">
        <label for="scope">Scope</label><select id="scope" name="scopeType"><option value="GLOBAL">Global</option><option value="ACCOUNT">One account</option></select>
        <label for="acct">Account ID (account scope)</label><input id="acct" name="scopeId">
        <label for="type">Transaction type</label><select id="type" name="transactionType"><option value="">All types</option>${SIM_TYPES.map((t) => html`<option value="${t}">${t}</option>`)}</select>
        <label for="status2">Status</label><select id="status2" name="status"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
        </div><div>
        <label for="formula">Formula</label><select id="formula" name="formula"><option value="FULL_AMOUNT">Full amount</option><option value="EXCESS_AMOUNT">Excess amount</option><option value="TIERED">Tiered</option></select>
        <label for="free">Free threshold (KSh)</label><input id="free" name="freeThreshold" type="number" min="0" value="20">
        <label for="per">KSh per token (full / excess)</label><input id="per" name="amountPerToken" type="number" min="1" value="5">
        <label for="tiers">Tiers (tiered) — one per line, e.g. 0-20:0, 21-100:3, 101-:8</label><textarea id="tiers" name="tiers"></textarea>
        <label for="from">Effective from</label><input id="from" name="effectiveFrom" type="datetime-local">
        </div></div><button>Publish</button></form>` : html``}`, '/admin/pricing'));
  }

  @Post('pricing')
  async publish(@Req() req: Req, @Res() res: Res, @Body() form: Form) {
    const session = await this.session(req, res);
    if (!session) return;
    try {
      this.guard(session, form, 'EDIT_PRICING');
    } catch (e) {
      return this.denied(res, session, e);
    }
    try {
      const formula = (['FULL_AMOUNT', 'EXCESS_AMOUNT', 'TIERED'].includes(form.formula ?? '') ? form.formula : 'FULL_AMOUNT') as PricingRule['formula'];
      const tiers: PricingTier[] | null = formula === 'TIERED'
        ? (form.tiers ?? '').split(/[\n,]+/).map((l) => l.trim()).filter(Boolean).map((l) => {
          const m = /^(\d+)\s*-\s*(\d*)\s*:\s*(\d+)$/.exec(l);
          if (!m) throw new Error(`Cannot read tier "${l}" — use min-max:tokens`);
          return { min: Number(m[1]), max: m[2] ? Number(m[2]) : null, tokens: Number(m[3]) };
        })
        : null;
      const rule: Omit<PricingRule, 'version'> = {
        id: (form.id ?? '').trim(),
        scopeType: form.scopeType === 'ACCOUNT' ? 'ACCOUNT' : 'GLOBAL',
        scopeId: form.scopeType === 'ACCOUNT' ? (form.scopeId ?? '').trim() || null : null,
        transactionType: (SIM_TYPES.includes(form.transactionType as SimulationType) ? form.transactionType : null) as SimulationType | null,
        formula,
        freeThreshold: Number(form.freeThreshold ?? 0),
        amountPerToken: formula === 'TIERED' ? null : Number(form.amountPerToken),
        tiers,
        effectiveFrom: form.effectiveFrom ? new Date(`${form.effectiveFrom}:00+03:00`).toISOString() : new Date().toISOString(),
        effectiveTo: null,
        status: form.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      };
      if (!/^[a-z0-9-]{3,40}$/.test(rule.id)) throw new Error('Rule ID: 3–40 lowercase letters, digits or dashes');
      const problems = validatePricingRule({ ...rule, version: 1 });
      if (problems.length) throw new Error(problems.join('; '));
      const published = await this.money.publishRule(rule, this.actor(session));
      this.back(res, '/admin/pricing', `Published ${published.id} v${published.version}`);
    } catch (e) {
      this.back(res, '/admin/pricing', e instanceof Error ? e.message : 'Could not publish', true);
    }
  }

  // ------------------------------------------------------------------------------------------ fees (§35.2, read-only for now)

  @Get('fees')
  async fees(@Req() req: Req, @Res() res: Res) {
    const session = await this.session(req, res);
    if (!session) return;
    const c = DEFAULT_CONFIG;
    this.send(res, layout('Transaction fees', session, html`
      <p class="muted">Simulated M-PESA tariffs (White Paper §13–17), config version ${c.version}. They are built into the app and server; editing them from here comes when fee schedules move to central configuration.</p>
      <div class="panel"><h2>Assignment</h2><table><tr><th>Transaction type</th><th>Fee schedule</th></tr>${Object.entries(c.feeScheduleByType).map(([t, id]) => html`<tr><td>${t}</td><td>${id}</td></tr>`)}</table></div>
      ${c.feeSchedules.map((sch) => html`<div class="panel"><h2>${sch.name} <span class="muted">(${sch.id} v${sch.version}, ${sch.status}, from ${fmtDate(sch.effectiveFrom)})</span></h2>
        <table><tr><th class="num">From KSh</th><th class="num">To KSh</th><th class="num">Fee KSh</th></tr>${sch.bands.map((b) => html`<tr><td class="num">${b.min}</td><td class="num">${b.max}</td><td class="num">${b.fee}</td></tr>`)}</table></div>`)}`, '/admin/fees'));
  }

  // ------------------------------------------------------------------------------------------ settings

  @Get('settings')
  async settings(@Req() req: Req, @Res() res: Res, @Query() q: { ok?: string; err?: string }) {
    const session = await this.session(req, res);
    if (!session) return;
    const st = await this.money.settings();
    const mayEdit = can(session.admin.role, 'EDIT_SETTINGS');
    const box = (name: keyof MonetizationSettings, label: string) =>
      html`<label><input type="checkbox" name="${name}" value="true" ${st[name] ? html`checked` : html``} ${mayEdit ? html`` : html`disabled`} class="check"> ${label}</label>`;
    const num = (name: keyof MonetizationSettings, label: string) =>
      html`<label for="${name}">${label}</label><input id="${name}" name="${name}" type="number" min="1" value="${st[name]}" ${mayEdit ? html`` : html`disabled`}>`;
    this.send(res, layout('Settings', session, html`${this.flash(q)}
      <form method="post" action="/admin/settings" class="panel">${csrf(session)}
        ${box('paymentRequired', 'Payments required — simulations that cost tokens must be paid (off = everything free)')}
        ${box('freeSimulationsOffline', 'Free simulations may run offline without a device allocation')}
        ${num('shillingsPerToken', 'Shillings per token')}${num('minimumPurchase', 'Smallest token purchase (KSh)')}${num('offlineAuthorizationDays', 'Offline authorization (days)')}
        ${mayEdit ? html`<button>Save settings</button>` : html`<p class="muted">Only administrators can change settings.</p>`}
      </form><p class="muted">Phones pick up changes on their next sync.</p>`, '/admin/settings'));
  }

  @Post('settings')
  async saveSettings(@Req() req: Req, @Res() res: Res, @Body() form: Form) {
    const session = await this.session(req, res);
    if (!session) return;
    try {
      this.guard(session, form, 'EDIT_SETTINGS');
    } catch (e) {
      return this.denied(res, session, e);
    }
    try {
      await this.money.updateSettings({
        paymentRequired: form.paymentRequired === 'true',
        freeSimulationsOffline: form.freeSimulationsOffline === 'true',
        shillingsPerToken: Number(form.shillingsPerToken),
        minimumPurchase: Number(form.minimumPurchase),
        offlineAuthorizationDays: Number(form.offlineAuthorizationDays),
      }, this.actor(session));
      this.back(res, '/admin/settings', 'Settings saved');
    } catch (e) {
      this.back(res, '/admin/settings', e instanceof Error ? e.message : 'Could not save', true);
    }
  }

  // ------------------------------------------------------------------------------------------ audit log (§35.8)

  @Get('audit')
  async audit(@Req() req: Req, @Res() res: Res) {
    const session = await this.session(req, res);
    if (!session) return;
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300');
    this.send(res, layout('Audit log', session, html`<div class="panel"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Reason</th><th>Change</th></tr>
      ${rows.map((r) => html`<tr><td>${fmtDate(r.created_at)}</td><td>${r.actor_id}</td><td>${r.action}</td><td>${r.entity_type} <span class="muted">${String(r.entity_id).slice(0, 12)}</span></td><td>${r.reason ?? ''}</td>
        <td>${r.before_value || r.after_value ? html`<details><summary>View</summary><pre>${JSON.stringify({ before: r.before_value, after: r.after_value }, null, 2)}</pre></details>` : html``}</td></tr>`)}
      </table></div>`, '/admin/audit'));
  }

  // ------------------------------------------------------------------------------------------ admin users

  @Get('users')
  async users(@Req() req: Req, @Res() res: Res, @Query() q: { ok?: string; err?: string }) {
    const session = await this.session(req, res);
    if (!session) return;
    if (!can(session.admin.role, 'MANAGE_ADMINS')) return this.denied(res, session, new Denied('Only administrators can manage admin users.'));
    const rows = await this.db.query<Record<string, unknown>>('SELECT id, email, name, role, status, last_login_at, created_at FROM admin_users ORDER BY created_at');
    this.send(res, layout('Admin users', session, html`${this.flash(q)}
      <div class="panel"><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr>
      ${rows.map((u) => html`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role}</td><td><span class="pill ${u.status === 'ACTIVE' ? 'ok' : 'bad'}">${u.status}</span></td><td>${fmtDate(u.last_login_at)}</td>
        <td>${u.status === 'ACTIVE' && u.id !== session.admin.id ? html`<form method="post" action="/admin/users/${u.id}/disable" class="inline">${csrf(session)}<button class="secondary">Disable</button></form>` : html``}</td></tr>`)}
      </table></div>
      <form method="post" action="/admin/users" class="panel">${csrf(session)}<h2>Add an admin user</h2>
        <label for="em">Email</label><input id="em" name="email" type="email" required><label for="nm">Name</label><input id="nm" name="name" required maxlength="80">
        <label for="rl">Role</label><select id="rl" name="role"><option value="VIEWER">Viewer — read only</option><option value="OPERATOR">Operator — day-to-day operations</option><option value="ADMIN">Administrator — everything</option></select>
        <label for="pw">Temporary password (10+ characters, letters and numbers)</label>${passwordField('pw', 'password', 'new-password')}
        <button>Add user</button></form>`, '/admin/users'));
  }

  @Post('users')
  async addUser(@Req() req: Req, @Res() res: Res, @Body() form: Form) {
    const session = await this.session(req, res);
    if (!session) return;
    try {
      this.guard(session, form, 'MANAGE_ADMINS');
    } catch (e) {
      return this.denied(res, session, e);
    }
    try {
      const role = (['ADMIN', 'OPERATOR', 'VIEWER'].includes(form.role ?? '') ? form.role : 'VIEWER') as AdminRole;
      await this.auth.createAdmin({ email: form.email ?? '', name: form.name ?? '', role, password: form.password ?? '' }, this.actor(session));
      this.back(res, '/admin/users', 'User added');
    } catch (e) {
      const msg = e instanceof Error && /unique|duplicate/i.test(e.message) ? 'That email already has an account' : e instanceof Error ? e.message : 'Could not add the user';
      this.back(res, '/admin/users', msg, true);
    }
  }

  @Post('users/:id/disable')
  async disableUser(@Req() req: Req, @Res() res: Res, @Param('id') id: string, @Body() form: Form) {
    const session = await this.session(req, res);
    if (!session) return;
    try {
      this.guard(session, form, 'MANAGE_ADMINS');
    } catch (e) {
      return this.denied(res, session, e);
    }
    if (id === session.admin.id) return this.back(res, '/admin/users', 'You cannot disable yourself', true);
    await this.auth.disable(id, this.actor(session));
    this.back(res, '/admin/users', 'User disabled');
  }
}

export { esc };
export type { Html };
