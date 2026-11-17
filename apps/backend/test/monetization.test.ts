/**
 * Monetization foundation on the server, against PostgreSQL (PGlite): White Paper §47.4 pricing,
 * §47.5 token ledger, §47.6 idempotency of token spends, §47.8 payment failures.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { priceSimulation, type PaymentRecord, type PricingSnapshot } from '@paspesa/core';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';
import { MonetizationService, type PaymentProvider } from '../src/monetization.service.js';

let db: Database;
let clock = '2026-11-17T09:00:00.000Z';
let money: MonetizationService;

beforeAll(async () => {
  db = await openDatabase({});
  money = new MonetizationService(db, () => clock);
});
afterAll(async () => {
  await db.close();
});

async function newAccount(): Promise<{ accountId: string; installationId: string }> {
  const installationId = randomUUID();
  const accountId = randomUUID();
  await db.query('INSERT INTO installations (id, token_hash) VALUES ($1, $2)', [installationId, randomUUID()]);
  await db.query(
    `INSERT INTO accounts (id, installation_id, account_name, phone_number, opening_balance, balance, version, currency, created_at, updated_at)
     VALUES ($1, $2, 'Paskal Twoli', '254759981287', 1000, 1000, 1, 'KES', now(), now())`,
    [accountId, installationId],
  );
  return { accountId, installationId };
}

const price = async (accountId: string, amount: number): Promise<PricingSnapshot> => money.quote(accountId, 'SEND_MONEY', amount);
const ledger = async (accountId: string) =>
  db.query<{ entry_type: string; source_category: string; quantity: number; direction: string; reference_id: string }>(
    'SELECT l.entry_type, l.source_category, l.quantity, l.direction, l.reference_id FROM token_ledger l JOIN token_wallets w ON w.id = l.wallet_id WHERE w.owner_id = $1 ORDER BY l.seq',
    [accountId],
  );

describe('pricing on the server (§27, §47.4)', () => {
  it('seeds the agreed default and prices KSh 100 at 20 tokens', async () => {
    const { accountId } = await newAccount();
    const config = await money.pricing();
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]).toMatchObject({ formula: 'FULL_AMOUNT', freeThreshold: 20, amountPerToken: 5 });
    expect((await price(accountId, 100)).tokenCost).toBe(20);
    expect((await price(accountId, 20)).tokenCost).toBe(0);
  });

  it('publishing a rule creates a new version, keeps the old one, and is audited; account overrides win', async () => {
    const { accountId } = await newAccount();
    const before = await price(accountId, 100);
    await money.publishRule({ id: 'acct-special', scopeType: 'ACCOUNT', scopeId: accountId, transactionType: 'SEND_MONEY', formula: 'EXCESS_AMOUNT', freeThreshold: 20, amountPerToken: 10, tiers: null, effectiveFrom: '2026-11-01T00:00:00Z', effectiveTo: null, status: 'ACTIVE' }, 'admin:test');
    const after = await price(accountId, 100);
    expect(after).toMatchObject({ tokenCost: 8, accountOverride: 'acct-special' });
    expect(after.configVersion).toBe(before.configVersion + 1);
    // an earlier snapshot is unchanged: historical costs are stored, never recomputed
    expect(before.tokenCost).toBe(20);
    // other accounts keep the global default
    const other = await newAccount();
    expect((await price(other.accountId, 100)).tokenCost).toBe(20);
    await money.publishRule({ id: 'acct-special', scopeType: 'ACCOUNT', scopeId: accountId, transactionType: 'SEND_MONEY', formula: 'EXCESS_AMOUNT', freeThreshold: 20, amountPerToken: 20, tiers: null, effectiveFrom: '2026-11-15T00:00:00Z', effectiveTo: null, status: 'ACTIVE' }, 'admin:test');
    expect((await price(accountId, 100)).tokenCost).toBe(4);
    const versions = await db.query<{ version: number; effective_to: Date | null }>("SELECT version, effective_to FROM pricing_rules WHERE id = 'acct-special' ORDER BY version");
    expect(versions.map((v) => [v.version, v.effective_to !== null])).toEqual([[1, true], [2, false]]);
    expect((await db.query("SELECT 1 FROM audit_log WHERE action = 'PUBLISH_PRICING_RULE' AND entity_id = 'acct-special'")).length).toBe(2);
  });

  it('rejects an invalid rule', async () => {
    await expect(money.publishRule({ id: 'bad', scopeType: 'GLOBAL', scopeId: null, transactionType: null, formula: 'TIERED', freeThreshold: 0, amountPerToken: null, tiers: [{ min: 5, max: null, tokens: 1 }], effectiveFrom: clock, effectiveTo: null, status: 'ACTIVE' }, 'admin:test'))
      .rejects.toThrow(/must start at KSh 0/);
  });
});

describe('token wallet on the server (§28, §47.5)', () => {
  it('credits each category once per reference; one total with a breakdown', async () => {
    const { accountId } = await newAccount();
    await money.grant({ accountId, category: 'PURCHASED', quantity: 100, reference: 'payment:p1', actor: 'test' });
    await money.grant({ accountId, category: 'ADMIN', quantity: 100, reference: 'admin:a1', actor: 'test' });
    const promo = await money.grant({ accountId, category: 'PROMOTIONAL', quantity: 100, reference: 'promo:launch', actor: 'test' });
    expect(promo.balances).toEqual({ PROMOTIONAL: 100, ADMIN: 100, PURCHASED: 100, total: 300 });
    const again = await money.grant({ accountId, category: 'PROMOTIONAL', quantity: 100, reference: 'promo:launch', actor: 'test' });
    expect(again.duplicate).toBe(true);
    expect((await money.wallet(accountId)).balances.total).toBe(300);
    await expect(money.grant({ accountId, category: 'PURCHASED', quantity: 5, reference: 'x', expiresAt: '2027-01-01T00:00:00Z', actor: 'test' })).rejects.toThrow(/do not expire/);
  });

  it('spends promotional → admin → purchased, records the sources, and never charges twice', async () => {
    const { accountId } = await newAccount();
    await money.grant({ accountId, category: 'PURCHASED', quantity: 100, reference: 'payment:p', actor: 'test' });
    await money.grant({ accountId, category: 'ADMIN', quantity: 100, reference: 'admin:a', actor: 'test' });
    await money.grant({ accountId, category: 'PROMOTIONAL', quantity: 100, reference: 'promo:p', actor: 'test' });
    const pricing = await price(accountId, 600); // 120 tokens
    const spend = await money.spendForSimulation({ accountId, simulationId: 'op-1', pricing });
    expect(spend).toMatchObject({ duplicate: false, quantity: 120, balances: { PROMOTIONAL: 0, ADMIN: 80, PURCHASED: 100, total: 180 } });
    const retry = await money.spendForSimulation({ accountId, simulationId: 'op-1', pricing });
    expect(retry).toMatchObject({ duplicate: true, quantity: 120 });
    const debits = (await ledger(accountId)).filter((e) => e.entry_type === 'SIMULATION_EXPENDITURE');
    expect(debits.map((d) => [d.source_category, Number(d.quantity), d.reference_id])).toEqual([['PROMOTIONAL', 100, 'op-1'], ['ADMIN', 20, 'op-1']]);
    await expect(money.spendForSimulation({ accountId, simulationId: 'op-2', pricing: { ...pricing, tokenCost: 500 } })).rejects.toThrow(/costs 500 tokens; 180 are available/);
    expect(await money.reconcile(accountId)).toEqual([]);
  });

  it('concurrent spends cannot overspend the wallet', async () => {
    const { accountId } = await newAccount();
    await money.grant({ accountId, category: 'PURCHASED', quantity: 50, reference: 'payment:c', actor: 'test' });
    const pricing = await price(accountId, 100); // 20 tokens each
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => money.spendForSimulation({ accountId, simulationId: `c-${n}`, pricing })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect((await money.wallet(accountId)).balances.total).toBe(10);
    expect(await money.reconcile(accountId)).toEqual([]);
  });

  it('a failed simulation restores exactly what it spent, as separate entries (§33.2)', async () => {
    const { accountId } = await newAccount();
    await money.grant({ accountId, category: 'PROMOTIONAL', quantity: 10, reference: 'promo:r', actor: 'test' });
    await money.grant({ accountId, category: 'PURCHASED', quantity: 100, reference: 'payment:r', actor: 'test' });
    await money.spendForSimulation({ accountId, simulationId: 'op-r', pricing: await price(accountId, 100) });
    const reversed = await money.reverseSimulation({ accountId, simulationId: 'op-r', reason: 'simulation failed' });
    expect(reversed).toMatchObject({ duplicate: false, balances: { PROMOTIONAL: 10, PURCHASED: 100, total: 110 } });
    expect(await money.reverseSimulation({ accountId, simulationId: 'op-r', reason: 'retry' })).toEqual({ duplicate: true });
    const types = (await ledger(accountId)).map((e) => `${e.entry_type}:${e.source_category}:${e.quantity}`);
    expect(types).toEqual([
      'PROMOTIONAL_GRANT:PROMOTIONAL:10', 'PURCHASE_CREDIT:PURCHASED:100',
      'SIMULATION_EXPENDITURE:PROMOTIONAL:10', 'SIMULATION_EXPENDITURE:PURCHASED:10',
      'EXPENDITURE_REVERSAL:PROMOTIONAL:10', 'EXPENDITURE_REVERSAL:PURCHASED:10',
    ]);
    expect(await money.reconcile(accountId)).toEqual([]);
  });

  it('expiry is a permanent entry per lot with its original grant; purchased tokens never expire', async () => {
    const { accountId } = await newAccount();
    clock = '2026-11-17T09:00:00.000Z';
    await money.grant({ accountId, category: 'PROMOTIONAL', quantity: 30, reference: 'promo:nov', expiresAt: '2026-11-30T00:00:00Z', actor: 'test' });
    await money.grant({ accountId, category: 'PURCHASED', quantity: 40, reference: 'payment:e', actor: 'test' });
    clock = '2026-12-01T00:00:00.000Z';
    expect((await money.wallet(accountId)).balances).toEqual({ PROMOTIONAL: 0, ADMIN: 0, PURCHASED: 40, total: 40 });
    expect(await money.expireDue()).toBeGreaterThanOrEqual(30);
    expect(await money.expireDue()).toBe(0); // safe to run again
    const expiry = (await ledger(accountId)).filter((e) => e.entry_type === 'EXPIRATION');
    expect(expiry.map((e) => [e.source_category, Number(e.quantity), e.reference_id])).toEqual([['PROMOTIONAL', 30, 'promo:nov']]);
    expect(await money.reconcile(accountId)).toEqual([]);
    clock = '2026-11-17T09:00:00.000Z';
  });
});

/** Test-only provider: no money moves. `results` decides what the provider reports. */
function sandbox(results: Record<string, 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'TIMEOUT'>) {
  let initiated = 0;
  const provider: PaymentProvider & { initiated: () => number } = {
    name: 'sandbox',
    initiated: () => initiated,
    async initiate(p: PaymentRecord) {
      initiated++;
      return { providerReference: `sbx-${p.id}` };
    },
    async checkStatus(ref: string) {
      const r = results[ref] ?? 'PENDING';
      if (r === 'TIMEOUT') throw new Error('provider timeout');
      return r;
    },
  };
  return provider;
}

describe('payments (§31–33, §47.8)', () => {
  it('buying tokens: pay KSh N, get N tokens — only after verification, exactly once; a timeout is not a failure', async () => {
    const { accountId } = await newAccount();
    const results: Record<string, 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'TIMEOUT'> = {};
    const provider = sandbox(results);
    const p = await money.initiateTokenPurchase({ accountId, shillings: 150, phone: '0759981287', idempotencyKey: 'buy-1' }, provider);
    expect(p).toMatchObject({ status: 'PENDING', amount: 150, tokens: 150, payerPhone: '254759981287', paymentType: 'TOKEN_PURCHASE' });
    // a repeated request (double tap, retry) is the same payment, not a second charge
    expect((await money.initiateTokenPurchase({ accountId, shillings: 150, phone: '0759981287', idempotencyKey: 'buy-1' }, provider)).id).toBe(p.id);
    expect(provider.initiated()).toBe(1);

    expect((await money.verifyPayment(p.id, provider)).status).toBe('PENDING'); // not confirmed yet
    results[p.providerReference!] = 'TIMEOUT';
    expect((await money.verifyPayment(p.id, provider)).status).toBe('PENDING'); // timeout ≠ failed
    expect((await money.wallet(accountId)).balances.total).toBe(0); // nothing credited unverified

    results[p.providerReference!] = 'SUCCESSFUL';
    expect(await money.verifyPendingPayments(provider)).toBeGreaterThanOrEqual(1);
    await money.verifyPayment(p.id, provider); // repeated callback / check
    expect((await money.wallet(accountId)).balances).toMatchObject({ PURCHASED: 150, total: 150 });
    const events = await db.query<{ event: string }>('SELECT event FROM payment_events WHERE payment_id = $1 ORDER BY id', [p.id]);
    expect(events.map((e) => e.event)).toEqual(['INITIATED', 'PENDING', 'STATUS_CHECK_TIMEOUT', 'VERIFIED_SUCCESSFUL']);
    await expect(money.initiateTokenPurchase({ accountId, shillings: 0, phone: '0759981287', idempotencyKey: 'buy-0' }, provider)).rejects.toThrow(/smallest purchase/);
    await expect(money.initiateTokenPurchase({ accountId, shillings: 10, phone: '12345', idempotencyKey: 'buy-bad' }, provider)).rejects.toThrow(/valid M-PESA number/);
  });

  it('pay-per-simulation costs the token price in shillings (KSh 100 simulation → KSh 20); authorized only when verified; a failed simulation gets a refundable credit once', async () => {
    const { accountId } = await newAccount();
    const results: Record<string, 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'TIMEOUT'> = {};
    const provider = sandbox(results);
    const { payment: p, pricing } = await money.initiateDirectPayment({ accountId, simulationId: 'op-direct', type: 'SEND_MONEY', simulationAmount: 100, phone: '0759981287', idempotencyKey: 'direct-1' }, provider);
    expect([pricing.tokenCost, p.amount, p.simulationStatus]).toEqual([20, 20, 'AWAITING_PAYMENT']);
    results[p.providerReference!] = 'SUCCESSFUL';
    expect((await money.verifyPayment(p.id, provider)).simulationStatus).toBe('AUTHORIZED');
    const failed = await money.recordDirectSimulationResult(p.id, 'FAILED');
    expect(failed).toMatchObject({ status: 'SUCCESSFUL', simulationStatus: 'FAILED', refundStatus: 'REFUNDABLE_CREDIT' });
    await money.recordDirectSimulationResult(p.id, 'FAILED');
    const credits = await db.query<{ amount: number }>('SELECT amount FROM payment_credits WHERE payment_id = $1', [p.id]);
    expect(credits.map((c) => Number(c.amount))).toEqual([20]);
  });

  it('a failed direct payment never authorizes the simulation; free simulations and Recharge need no payment', async () => {
    const { accountId } = await newAccount();
    const results: Record<string, 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'TIMEOUT'> = {};
    const provider = sandbox(results);
    const { payment: p } = await money.initiateDirectPayment({ accountId, simulationId: 'op-x', type: 'BUY_GOODS', simulationAmount: 50, phone: '0759981287', idempotencyKey: 'direct-x' }, provider);
    results[p.providerReference!] = 'FAILED';
    expect(await money.verifyPayment(p.id, provider)).toMatchObject({ status: 'FAILED', simulationStatus: 'FAILED', refundStatus: 'NONE' });
    await expect(money.initiateDirectPayment({ accountId, simulationId: 'op-y', type: 'BUY_GOODS', simulationAmount: 20, phone: '0759981287', idempotencyKey: 'direct-y' }, provider)).rejects.toThrow(/free/);
    await expect(money.initiateDirectPayment({ accountId, simulationId: 'op-z', type: 'RECHARGE', simulationAmount: 5_000, phone: '0759981287', idempotencyKey: 'direct-z' }, provider)).rejects.toThrow(/free/);
  });

  it('back-office settings: defaults, audited changes, validation', async () => {
    expect(await money.settings()).toEqual({ paymentRequired: false, freeSimulationsOffline: true, shillingsPerToken: 1, minimumPurchase: 1, offlineAuthorizationDays: 3 });
    expect((await money.updateSettings({ freeSimulationsOffline: false }, 'admin:test')).freeSimulationsOffline).toBe(false);
    expect((await money.settings()).freeSimulationsOffline).toBe(false);
    await expect(money.updateSettings({ shillingsPerToken: 0 }, 'admin:test')).rejects.toThrow(/at least 1/);
    expect((await db.query("SELECT 1 FROM audit_log WHERE action = 'UPDATE_MONETIZATION_SETTINGS'")).length).toBe(1);
    await money.updateSettings({ freeSimulationsOffline: true }, 'admin:test');
  });
});

describe('monetization API (read-only)', () => {
  it('pricing, quote and wallet over HTTP for a registered installation', async () => {
    const app = await createApp(db);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    try {
      const installationId = randomUUID();
      const token = 'x'.repeat(40) + randomUUID();
      await fetch(`${base}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId, token }) });
      const accountId = randomUUID();
      await db.query(
        `INSERT INTO accounts (id, installation_id, account_name, phone_number, opening_balance, balance, version, currency, created_at, updated_at)
         VALUES ($1, $2, 'Paskal Twoli', '254759981287', 1000, 1000, 1, 'KES', now(), now())`,
        [accountId, installationId],
      );
      await money.grant({ accountId, category: 'PROMOTIONAL', quantity: 25, reference: 'promo:api', actor: 'test' });
      const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const pricing = (await (await fetch(`${base}/v1/pricing`, { headers: auth })).json()) as { version: number };
      expect(pricing.version).toBeGreaterThanOrEqual(1);
      const quote = (await (await fetch(`${base}/v1/pricing/quote`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'BUY_GOODS', amount: 100 }) })).json()) as PricingSnapshot;
      expect(quote).toEqual(priceSimulation(await money.pricing(), { accountId, type: 'BUY_GOODS', amount: 100, at: clock }));
      const wallet = (await (await fetch(`${base}/v1/wallet`, { headers: auth })).json()) as { balances: { total: number } };
      expect(wallet.balances.total).toBe(25);
      const bad = await fetch(`${base}/v1/pricing/quote`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'NOPE', amount: 1 }) });
      expect(bad.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});
