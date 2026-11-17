import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MONETIZATION_SETTINGS,
  DEFAULT_PRICING,
  directPrice,
  mayRunOfflineWithoutAllocation,
  tokensForShillings,
  DEFAULT_PRICING_RULE,
  canMovePayment,
  canMoveRefund,
  needsRefund,
  planDeduction,
  planExpiry,
  priceSimulation,
  reconcileWallet,
  resolvePricingRule,
  tokenCost,
  validatePricingRule,
  walletBalances,
  type PaymentRecord,
  type PricingConfiguration,
  type PricingRule,
  type TokenLedgerEntry,
  type TokenLot,
} from '../src';

const AT = '2026-11-17T09:00:00.000Z';
const rule = (patch: Partial<PricingRule>): PricingRule => ({ ...DEFAULT_PRICING_RULE, ...patch });

describe('pricing engine (§27, §47.4)', () => {
  it('defaults: full amount, free up to KSh 20, KSh 5 per token — the White Paper table', () => {
    expect(DEFAULT_PRICING_RULE).toMatchObject({ formula: 'FULL_AMOUNT', freeThreshold: 20, amountPerToken: 5 });
    const table: Array<[number, number]> = [[10, 0], [20, 0], [21, 5], [25, 5], [100, 20], [500, 100]];
    for (const [amount, tokens] of table) {
      expect(priceSimulation(DEFAULT_PRICING, { accountId: 'a1', type: 'SEND_MONEY', amount, at: AT }).tokenCost).toBe(tokens);
    }
  });

  it('excess amount formula deducts the free threshold first', () => {
    const r = rule({ formula: 'EXCESS_AMOUNT' });
    expect([20, 21, 25, 26, 100].map((a) => tokenCost(r, a))).toEqual([0, 1, 1, 2, 16]);
  });

  it('tiered pricing uses the configured ranges, and rejects gaps, overlaps and uncovered amounts', () => {
    const r = rule({ formula: 'TIERED', amountPerToken: null, tiers: [{ min: 0, max: 20, tokens: 0 }, { min: 21, max: 100, tokens: 3 }, { min: 101, max: 500, tokens: 8 }, { min: 501, max: 1_000, tokens: 15 }] });
    expect(validatePricingRule(r)).toEqual([]);
    expect([0, 20, 21, 100, 101, 500, 1_000].map((a) => tokenCost(r, a))).toEqual([0, 0, 3, 3, 8, 8, 15]);
    expect(() => tokenCost(r, 1_001)).toThrow(/No pricing range covers/);
    expect(validatePricingRule(rule({ formula: 'TIERED', amountPerToken: null, tiers: [{ min: 0, max: 20, tokens: 0 }, { min: 30, max: null, tokens: 5 }] }))).toContain('Range 2 must start at KSh 21 (no gaps or overlaps)');
    expect(validatePricingRule(rule({ amountPerToken: 0 }))).toContain('Amount per token must be a whole number above zero');
  });

  it('precedence: account + type → account default → global type → global default', () => {
    const config: PricingConfiguration = {
      version: 7,
      rules: [
        DEFAULT_PRICING_RULE,
        rule({ id: 'global-paybill', transactionType: 'PAYBILL', amountPerToken: 10 }),
        rule({ id: 'acct-default', scopeType: 'ACCOUNT', scopeId: 'vip', amountPerToken: 50 }),
        rule({ id: 'acct-send', scopeType: 'ACCOUNT', scopeId: 'vip', transactionType: 'SEND_MONEY', amountPerToken: 100 }),
      ],
    };
    const pick = (accountId: string, type: 'SEND_MONEY' | 'PAYBILL' | 'BUY_GOODS') => resolvePricingRule(config, { accountId, type, at: AT }).id;
    expect(pick('vip', 'SEND_MONEY')).toBe('acct-send');
    expect(pick('vip', 'PAYBILL')).toBe('acct-default'); // account default beats the global Paybill rule
    expect(pick('other', 'PAYBILL')).toBe('global-paybill');
    expect(pick('other', 'BUY_GOODS')).toBe('global-default');
    const snap = priceSimulation(config, { accountId: 'vip', type: 'SEND_MONEY', amount: 1_000, at: AT });
    expect(snap).toMatchObject({ tokenCost: 10, accountOverride: 'acct-send', configVersion: 7, formula: 'FULL_AMOUNT', amountPerToken: 100 });
  });

  it('versioning: a later rule applies only from its effective date; earlier snapshots keep their price', () => {
    const config: PricingConfiguration = {
      version: 2,
      rules: [
        rule({ effectiveTo: '2026-12-01T00:00:00Z' }),
        rule({ id: 'global-default', version: 2, amountPerToken: 10, effectiveFrom: '2026-12-01T00:00:00Z' }),
      ],
    };
    const before = priceSimulation(config, { accountId: 'a', type: 'BUY_GOODS', amount: 100, at: AT });
    const after = priceSimulation(config, { accountId: 'a', type: 'BUY_GOODS', amount: 100, at: '2026-12-02T00:00:00Z' });
    expect([before.tokenCost, before.resolvedRule]).toEqual([20, 'global-default@v1']);
    expect([after.tokenCost, after.resolvedRule]).toEqual([10, 'global-default@v2']);
    // inactive rules are ignored
    expect(resolvePricingRule({ version: 3, rules: [rule({ status: 'INACTIVE', amountPerToken: 1 }), rule({ version: 0 })] }, { accountId: 'a', type: 'BUY_GOODS', at: AT }).version).toBe(0);
  });
});

const lot = (id: string, category: TokenLot['category'], qty: number, extra: Partial<TokenLot> = {}): TokenLot => ({
  id, walletId: 'w', category, originalQuantity: qty, remainingQuantity: qty, reservedQuantity: 0, createdAt: '2026-11-01T00:00:00Z', expiresAt: null, sourceReference: `ref-${id}`, ...extra,
});

describe('token wallet (§28, §47.5)', () => {
  it('one balance with a category breakdown', () => {
    const lots = [lot('p', 'PURCHASED', 300), lot('pr', 'PROMOTIONAL', 100), lot('ad', 'ADMIN', 100)];
    expect(walletBalances(lots, AT)).toEqual({ PURCHASED: 300, PROMOTIONAL: 100, ADMIN: 100, total: 500 });
  });

  it('spends promotional first, then admin-issued, then purchased — the White Paper example', () => {
    const lots = [lot('p', 'PURCHASED', 100), lot('ad', 'ADMIN', 100), lot('pr', 'PROMOTIONAL', 100)];
    const plan = planDeduction(lots, 120, AT);
    expect(plan).toEqual({ ok: true, deductions: [{ lotId: 'pr', category: 'PROMOTIONAL', quantity: 100 }, { lotId: 'ad', category: 'ADMIN', quantity: 20 }] });
  });

  it('within a category, the lot expiring first is spent first; expired lots are not spendable', () => {
    const lots = [
      lot('late', 'PROMOTIONAL', 10, { expiresAt: '2026-12-31T00:00:00Z' }),
      lot('soon', 'PROMOTIONAL', 10, { expiresAt: '2026-11-20T00:00:00Z' }),
      lot('gone', 'PROMOTIONAL', 50, { expiresAt: '2026-11-10T00:00:00Z' }),
    ];
    expect(planDeduction(lots, 12, AT)).toEqual({ ok: true, deductions: [{ lotId: 'soon', category: 'PROMOTIONAL', quantity: 10 }, { lotId: 'late', category: 'PROMOTIONAL', quantity: 2 }] });
    expect(planDeduction(lots, 21, AT)).toEqual({ ok: false, available: 20 });
    expect(planExpiry(lots, AT)).toEqual([{ lotId: 'gone', category: 'PROMOTIONAL', quantity: 50 }]);
  });

  it('reconciliation catches a balance that does not match its ledger', () => {
    const lots = [lot('p', 'PURCHASED', 100, { remainingQuantity: 80 })];
    const e = (direction: 'CREDIT' | 'DEBIT', quantity: number): TokenLedgerEntry => ({
      id: `${direction}${quantity}`, walletId: 'w', entryType: direction === 'CREDIT' ? 'PURCHASE_CREDIT' : 'SIMULATION_EXPENDITURE', category: 'PURCHASED',
      quantity, direction, referenceType: 'PAYMENT', referenceId: 'x', lotId: 'p', deviceId: null, createdAt: AT, expiresAt: null, metadata: null,
    });
    expect(reconcileWallet(lots, [e('CREDIT', 100), e('DEBIT', 20)])).toEqual([]);
    expect(reconcileWallet(lots, [e('CREDIT', 100), e('DEBIT', 25)])).toEqual(['Lot p: ledger says 75, lot says 80']);
  });
});

describe('payments (§33)', () => {
  const p = (patch: Partial<PaymentRecord>): PaymentRecord => ({
    id: 'pay', ownerId: 'a', paymentType: 'DIRECT_SIMULATION', provider: 'sandbox', providerReference: null, idempotencyKey: 'k', amount: 10, currency: 'KES',
    status: 'SUCCESSFUL', tokens: null, payerPhone: '254759981287', relatedSimulationId: 'op', simulationStatus: 'FAILED', refundStatus: 'NONE', createdAt: AT, verifiedAt: AT, ...patch,
  });
  it('a timeout keeps the payment pending; final states never change', () => {
    expect(canMovePayment('PENDING', 'PENDING')).toBe(true);
    expect(canMovePayment('SUCCESSFUL', 'FAILED')).toBe(false);
    expect(canMovePayment('FAILED', 'SUCCESSFUL')).toBe(false);
  });
  it('a paid simulation that failed needs a refund or refundable credit', () => {
    expect(needsRefund(p({}))).toBe(true);
    expect(needsRefund(p({ refundStatus: 'REFUNDABLE_CREDIT' }))).toBe(false);
    expect(needsRefund(p({ simulationStatus: 'SUCCESSFUL' }))).toBe(false);
    expect(canMoveRefund('NONE', 'REFUNDABLE_CREDIT')).toBe(true);
    expect(canMoveRefund('REFUNDED', 'NONE')).toBe(false);
  });
});

describe('owner decisions of 2026-11-17', () => {
  it('1 token = KSh 1: a KSh 100 simulation costs 20 tokens or KSh 20 paid directly; KSh 50 buys 50 tokens', () => {
    const p = priceSimulation(DEFAULT_PRICING, { accountId: 'a', type: 'SEND_MONEY', amount: 100, at: AT });
    expect([p.tokenCost, directPrice(p), tokensForShillings(50)]).toEqual([20, 20, 50]);
  });
  it('Recharge is never priced, whatever the amount', () => {
    expect(priceSimulation(DEFAULT_PRICING, { accountId: 'a', type: 'RECHARGE', amount: 250_000, at: AT })).toMatchObject({ tokenCost: 0, resolvedRule: 'not-priced (RECHARGE)' });
  });
  it('free simulations may run offline while the back-office setting allows it; payment stays off until activation', () => {
    expect(DEFAULT_MONETIZATION_SETTINGS).toMatchObject({ paymentRequired: false, freeSimulationsOffline: true, shillingsPerToken: 1 });
    const free = priceSimulation(DEFAULT_PRICING, { accountId: 'a', type: 'BUY_GOODS', amount: 20, at: AT });
    const paid = priceSimulation(DEFAULT_PRICING, { accountId: 'a', type: 'BUY_GOODS', amount: 21, at: AT });
    expect(mayRunOfflineWithoutAllocation(free, DEFAULT_MONETIZATION_SETTINGS)).toBe(true);
    expect(mayRunOfflineWithoutAllocation(free, { ...DEFAULT_MONETIZATION_SETTINGS, freeSimulationsOffline: false })).toBe(false);
    expect(mayRunOfflineWithoutAllocation(paid, DEFAULT_MONETIZATION_SETTINGS)).toBe(false);
  });
});
