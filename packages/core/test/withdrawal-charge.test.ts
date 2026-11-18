import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, reconcileAccount, withdrawalChargeFor } from '../src';
import { makeAccount, newOp, processSimulation } from './helpers';

describe('Send Money: add withdrawal charges', () => {
  it('charge comes from the agent withdrawal schedule; none below its minimum', () => {
    expect(withdrawalChargeFor(DEFAULT_CONFIG, 49)).toBeNull();
    expect(withdrawalChargeFor(DEFAULT_CONFIG, 50)).toBe(11);
    expect(withdrawalChargeFor(DEFAULT_CONFIG, 100)).toBe(11);
  });

  it('sends amount + charge, prices the tariff on the total, and records the charge', async () => {
    const { deps, store } = await makeAccount(1_000);
    // 100 + 11 = 111 sent; tariff band 101-500 => fee 7; total debit 118
    const res = await processSimulation(deps, {
      operationId: newOp(), type: 'SEND_MONEY', amount: 100, addWithdrawalCharge: true,
      counterparty: { phone: '0111000222', name: 'Amina Wanjiru' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transaction.amount).toBe(111);
    expect(res.transaction.withdrawalCharge).toBe(11);
    expect(res.transaction.fee).toBe(7);
    expect(res.transaction.balanceAfter).toBe(1_000 - 118);
    expect(res.message?.body).toContain('Ksh111.00 sent to');
    expect((await reconcileAccount(store)).ok).toBe(true);
  });

  it('is rejected for other types and for amounts below the withdrawal minimum', async () => {
    const { deps } = await makeAccount(1_000);
    const low = await processSimulation(deps, {
      operationId: newOp(), type: 'SEND_MONEY', amount: 30, addWithdrawalCharge: true,
      counterparty: { phone: '0111000222', name: 'P' },
    });
    expect(!low.ok && low.error.code).toBe('VALIDATION');
    const till = await processSimulation(deps, {
      operationId: newOp(), type: 'BUY_GOODS', amount: 100, addWithdrawalCharge: true,
      counterparty: { tillNumber: '6484844', name: 'M' },
    });
    expect(!till.ok && till.error.code).toBe('VALIDATION');
  });

  it('the option is part of the idempotency fingerprint', async () => {
    const { deps } = await makeAccount(1_000);
    const req = { operationId: 'op-wc', type: 'SEND_MONEY' as const, amount: 100, counterparty: { phone: '0111000222', name: 'P' } };
    expect((await processSimulation(deps, req)).ok).toBe(true);
    const again = await processSimulation(deps, { ...req, addWithdrawalCharge: true });
    expect(!again.ok && again.error.code).toBe('OPERATION_CONFLICT');
  });
});
