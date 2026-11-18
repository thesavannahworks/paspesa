import { describe, expect, it } from 'vitest';
import { reconcileAccount } from '../src';
import { makeAccount, newOp, processSimulation } from './helpers';

describe('General Operations recharge (§10, §47.2)', () => {
  it('adds to the previous balance (1,000 + 500 = 1,500) — never replaces it', async () => {
    const { deps, store } = await makeAccount(1_000);
    const res = await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 500, counterparty: {} });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transaction.balanceBefore).toBe(1_000);
    expect(res.transaction.balanceAfter).toBe(1_500);
    expect(res.account.currentBalanceCache).toBe(1_500);
    expect((await store.getAccount())!.currentBalanceCache).toBe(1_500);
  });

  it('is recorded as an incoming (CREDIT) transaction with source General Operations and no fee', async () => {
    const { deps } = await makeAccount(0);
    const res = await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 750, counterparty: {} });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.transaction).toMatchObject({
      type: 'RECHARGE', direction: 'CREDIT', status: 'SUCCESSFUL', source: 'GENERAL_OPERATIONS',
      amount: 750, fee: 0, totalDebit: 0, syncStatus: 'PENDING',
    });
  });

  it('applies the default Paspesa sender when none is supplied', async () => {
    const { deps } = await makeAccount(0);
    const res = await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 100, counterparty: {} });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.transaction.counterparty).toEqual({ name: 'Paspesa', phone: deps.config.defaultRechargeSender.phone });
  });

  it('retains a custom sender name and phone number', async () => {
    const { deps } = await makeAccount(0);
    const res = await processSimulation(deps, {
      operationId: newOp(), type: 'RECHARGE', amount: 700, counterparty: { name: 'Kevin Ouma', phone: '0745 123 456' },
    });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.transaction.counterparty).toEqual({ name: 'Kevin Ouma', phone: '254745123456' });
    expect(res.message!.body).toContain('from Kevin  Ouma 0745***456');
  });

  it('creates the matching incoming message', async () => {
    const { deps } = await makeAccount(24_371);
    const res = await processSimulation(deps, {
      operationId: newOp(), type: 'RECHARGE', amount: 700, counterparty: { name: 'Kevin Ouma', phone: '0745123456' },
    });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.message!.body).toMatch(
      new RegExp(`^${res.transaction.reference} Confirmed\\.You have received Ksh700\\.00 from Kevin  Ouma 0745\\*\\*\\*456 on \\d\\d/\\d\\d/\\d\\d at \\d{1,2}:\\d\\d (AM|PM)  New M-PESA balance is Ksh25,071\\.00\\. Invest & earn daily interest with ZIIDI on https://saf\\.cx/cF6ir$`),
    );
  });

  it('repeated submission with the same operation ID adds the amount only once', async () => {
    const { deps, store } = await makeAccount(1_000);
    const op = newOp();
    const req = { operationId: op, type: 'RECHARGE' as const, amount: 500, counterparty: {} };
    const first = await processSimulation(deps, req);
    const second = await processSimulation(deps, req);
    const third = await processSimulation(deps, req);
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(third.message!.id).toBe(first.message!.id);
    expect((await store.getAccount())!.currentBalanceCache).toBe(1_500);
    expect((await store.listTransactions()).filter((t) => t.type === 'RECHARGE')).toHaveLength(1);
    expect(await store.listMessages()).toHaveLength(1);
    expect((await reconcileAccount(store)).ok).toBe(true);
  });

  it('two separate recharge submissions are two separate operations', async () => {
    const { deps, store } = await makeAccount(1_000);
    await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 500, counterparty: {} });
    await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 500, counterparty: {} });
    expect((await store.getAccount())!.currentBalanceCache).toBe(2_000);
  });

  it('validates amount (whole shillings, 1–250,000) and custom phone', async () => {
    const { deps } = await makeAccount(0);
    const bad = async (amount: number, phone?: string) =>
      processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount, counterparty: phone ? { phone } : {} });
    expect((await bad(0)).ok).toBe(false);
    expect((await bad(10.5)).ok).toBe(false);
    const tooBig = await bad(250_001);
    expect(!tooBig.ok && tooBig.error.code).toBe('UNSUPPORTED_AMOUNT');
    const badPhone = await bad(100, '12345');
    expect(!badPhone.ok && badPhone.error.fieldErrors?.phone).toBeTruthy();
    expect((await bad(250_000)).ok).toBe(true);
  });
});
