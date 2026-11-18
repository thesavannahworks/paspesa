import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_PRICING, adoptAllocation, setTokenAllocation, type EngineDeps } from '../src';
import { makeAccount, newOp, processSimulation } from './helpers';

const send = (amount: number, extra: object = {}) => ({ operationId: newOp(), type: 'SEND_MONEY' as const, amount, counterparty: { phone: '0722000111', name: 'Peter Kamau' }, ...extra });
const allocation = (remaining: number, expires = '2026-11-20T00:00:00.000Z') => ({ allocationId: 'alloc-1', remaining, authorizationExpiresAt: expires, pricing: DEFAULT_PRICING });
const paymentsOn = (deps: EngineDeps, extra: object = {}): EngineDeps => ({ ...deps, config: { ...DEFAULT_CONFIG, monetization: { ...DEFAULT_CONFIG.monetization, paymentRequired: true, ...extra } } });

describe('paying for simulations on the device (§26, §29)', () => {
  it('while payments are off everything stays free (current behaviour)', async () => {
    const { deps } = await makeAccount(10_000);
    const r = await processSimulation(deps, send(500));
    expect(r.ok && [r.transaction.paymentMethod, r.transaction.pricing]).toEqual(['UNMETERED', null]);
  });

  it('tokens: spends from the device allocation offline and stores the pricing snapshot', async () => {
    const { deps, store } = await makeAccount(10_000);
    await setTokenAllocation(deps, allocation(50));
    const r = await processSimulation(paymentsOn(deps), send(100, { paymentMethod: 'TOKENS' }));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.transaction.pricing).toMatchObject({ tokenCost: 20, formula: 'FULL_AMOUNT', amountPerToken: 5 });
    expect((await store.getAccount())!.tokenAllocation!.remaining).toBe(30);
    const tooMuch = await processSimulation(paymentsOn(deps), send(200, { paymentMethod: 'TOKENS' }));
    expect(!tooMuch.ok && tooMuch.error.code).toBe('INSUFFICIENT_TOKENS');
  });

  it('an expired authorization stops paid offline simulations, not the records', async () => {
    const { deps } = await makeAccount(10_000);
    await setTokenAllocation(deps, allocation(50, '2026-11-01T00:00:00.000Z'));
    const r = await processSimulation(paymentsOn(deps), send(100, { paymentMethod: 'TOKENS' }));
    expect(!r.ok && r.error.code).toBe('AUTHORIZATION_EXPIRED');
  });

  it('with payments on, a priced simulation needs a payment method; free ones follow the offline setting', async () => {
    const { deps } = await makeAccount(10_000);
    const priced = await processSimulation(paymentsOn(deps), send(100));
    expect(!priced.ok && priced.error.code).toBe('PAYMENT_REQUIRED');
    expect((await processSimulation(paymentsOn(deps), send(20))).ok).toBe(true);
    const strict = await processSimulation(paymentsOn(deps, { freeSimulationsOffline: false }), send(20));
    expect(!strict.ok && strict.error.code).toBe('AUTHORIZATION_REQUIRED');
    await setTokenAllocation(deps, allocation(0));
    expect((await processSimulation(paymentsOn(deps, { freeSimulationsOffline: false }), send(20))).ok).toBe(true);
  });

  it('direct payment needs the verified payment; Recharge is never priced', async () => {
    const { deps } = await makeAccount(10_000);
    const missing = await processSimulation(paymentsOn(deps), send(100, { paymentMethod: 'DIRECT' }));
    expect(!missing.ok && missing.error.code).toBe('PAYMENT_REQUIRED');
    const paid = await processSimulation(paymentsOn(deps), send(100, { paymentMethod: 'DIRECT', directPaymentId: 'pay-1' }));
    expect(paid.ok && [paid.transaction.directPaymentId, paid.transaction.pricing?.tokenCost]).toEqual(['pay-1', 20]);
    expect((await processSimulation(paymentsOn(deps), { operationId: newOp(), type: 'RECHARGE', amount: 5_000, counterparty: {} })).ok).toBe(true);
  });

  it('adopting the server allocation keeps unconfirmed offline spends deducted', async () => {
    const { deps, store } = await makeAccount(10_000);
    await setTokenAllocation(deps, allocation(50));
    await processSimulation(paymentsOn(deps), send(100, { paymentMethod: 'TOKENS' })); // 20 tokens, not yet synced
    await adoptAllocation(deps, { allocationId: 'alloc-1', remaining: 80, authorizationExpiresAt: '2026-11-23T00:00:00.000Z', pricing: DEFAULT_PRICING });
    expect((await store.getAccount())!.tokenAllocation).toMatchObject({ remaining: 60, authorizationExpiresAt: '2026-11-23T00:00:00.000Z' });
    await adoptAllocation(deps, null);
    expect((await store.getAccount())!.tokenAllocation).toBeNull();
  });
});
