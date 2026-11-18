import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  quoteSimulation,
  reconcileAccount,
  setupAccount,
  type SimulationRequest,
} from '../src';
import { makeAccount, makeDeps, newOp, processSimulation, TEST_PIN } from './helpers';

const sendMoney = (amount: number, extra: Partial<SimulationRequest> = {}): SimulationRequest => ({
  operationId: newOp(),
  type: 'SEND_MONEY',
  amount,
  counterparty: { name: 'Amina Wanjiru', phone: '254111000222' },
  ...extra,
});

describe('account setup and opening balance (§10.1)', () => {
  it('creates the account with an opening-balance ledger entry and no message', async () => {
    const { deps, store } = await makeAccount(5_000);
    const account = (await store.getAccount())!;
    expect(account).toMatchObject({ openingBalance: 5_000, currentBalanceCache: 5_000, phoneNumber: '254798765432', version: 1 });
    const [opening] = await store.listTransactions();
    expect(opening).toMatchObject({ type: 'OPENING_BALANCE', direction: 'CREDIT', amount: 5_000, balanceBefore: 0, balanceAfter: 5_000, sequence: 1 });
    expect(await store.listMessages()).toHaveLength(0);
    expect((await store.listOutbox()).map((e) => e.operationType)).toEqual(['CREATE_ACCOUNT']);
    expect((await reconcileAccount(store)).ok).toBe(true);
    void deps;
  });

  it('allows a zero opening balance and rejects more than KSh 250,000', async () => {
    const zero = makeDeps();
    expect((await setupAccount(zero.deps, { operationId: 'a', accountName: 'X', phoneNumber: '0798765432', openingBalance: 0, pin: TEST_PIN })).ok).toBe(true);
    const big = makeDeps();
    const res = await setupAccount(big.deps, { operationId: 'b', accountName: 'X', phoneNumber: '0798765432', openingBalance: 250_001, pin: TEST_PIN });
    expect(!res.ok && res.error.fieldErrors?.openingBalance).toBeTruthy();
  });

  it('is idempotent and refuses a second, different account', async () => {
    const { deps } = makeDeps();
    const req = { operationId: 'setup-1', accountName: 'Amina', phoneNumber: '0798765432', openingBalance: 100, pin: TEST_PIN };
    const a = await setupAccount(deps, req);
    const b = await setupAccount(deps, req);
    expect(a.ok && b.ok && b.duplicate).toBe(true);
    const c = await setupAccount(deps, { ...req, operationId: 'setup-2' });
    expect(!c.ok && c.error.code).toBe('ACCOUNT_EXISTS');
  });
});

describe('transaction engine (§11, §17, §47.1)', () => {
  it('White Paper example: 10,000 − (2,000 + 33) = 7,967', async () => {
    const { deps, store } = await makeAccount(10_000);
    const res = await processSimulation(deps, sendMoney(2_000));
    if (!res.ok) throw new Error(res.error.message);
    expect(res.transaction).toMatchObject({ amount: 2_000, fee: 33, totalDebit: 2_033, balanceBefore: 10_000, balanceAfter: 7_967 });
    expect((await store.getAccount())!.currentBalanceCache).toBe(7_967);
    expect((await reconcileAccount(store)).ok).toBe(true);
  });

  it('quote shown at confirmation equals the committed values', async () => {
    const { deps, store } = await makeAccount(10_000);
    const req = sendMoney(5_001);
    const quote = quoteSimulation((await store.getAccount())!, deps.config, req);
    const res = await processSimulation(deps, req);
    if (!quote.ok || !res.ok) throw new Error('unexpected failure');
    expect(res.transaction.fee).toBe(quote.quote.fee);
    expect(res.transaction.totalDebit).toBe(quote.quote.totalDebit);
    expect(res.transaction.balanceAfter).toBe(quote.quote.balanceAfter);
  });

  it('applies the correct schedule per type', async () => {
    const { deps } = await makeAccount(100_000);
    const run = async (req: Omit<SimulationRequest, 'operationId'>) => {
      const r = await processSimulation(deps, { operationId: newOp(), ...req });
      if (!r.ok) throw new Error(r.error.message);
      return r.transaction.fee;
    };
    expect(await run({ type: 'SEND_MONEY', amount: 1_000, counterparty: { name: 'A', phone: '0798765432' } })).toBe(13);
    expect(await run({ type: 'POCHI', amount: 1_000, counterparty: { name: 'Mama Mboga', phone: '0798765432' } })).toBe(13);
    expect(await run({ type: 'PAYBILL', amount: 1_000, counterparty: { paybillNumber: '400200', businessName: 'Co-op Bank', accountReference: '4001077' } })).toBe(13);
    expect(await run({ type: 'BUY_GOODS', amount: 1_000, counterparty: { tillNumber: '6484844', name: 'Innocent Achoka' } })).toBe(0);
    expect(await run({ type: 'AIRTIME', amount: 1_000, variant: 'OWN', counterparty: {} })).toBe(0);
    expect(await run({ type: 'WITHDRAW', amount: 1_000, counterparty: { agentNumber: '123456' } })).toBe(29);
  });

  it('rejects insufficient balance including the fee, leaving no partial state', async () => {
    const { deps, store } = await makeAccount(1_000);
    const before = store.snapshot();
    const res = await processSimulation(deps, sendMoney(990)); // 990 + 13 fee = 1,003 > 1,000
    expect(!res.ok && res.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(store.snapshot()).toEqual(before);
    const exact = await processSimulation(deps, sendMoney(987)); // 987 + 13 = 1,000
    expect(exact.ok && exact.transaction.balanceAfter).toBe(0);
  });

  it('validates required fields per type', async () => {
    const { deps } = await makeAccount(10_000);
    const r1 = await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 100, counterparty: { phone: 'abc' } });
    expect(!r1.ok && r1.error.fieldErrors).toMatchObject({ phone: expect.any(String), name: expect.any(String) });
    const r2 = await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 100, counterparty: { tillNumber: '12' } });
    expect(!r2.ok && r2.error.fieldErrors).toMatchObject({ tillNumber: expect.any(String), name: expect.any(String) });
    const r3 = await processSimulation(deps, { operationId: newOp(), type: 'PAYBILL', amount: 100, counterparty: { paybillNumber: '400200' } });
    expect(!r3.ok && r3.error.fieldErrors).toMatchObject({ businessName: expect.any(String), accountReference: expect.any(String) });
    const r4 = await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', amount: 10, variant: 'OTHER', counterparty: {} });
    expect(!r4.ok && r4.error.fieldErrors?.phone).toBeTruthy();
    const r5 = await processSimulation(deps, sendMoney(100, { amount: 99.5 }));
    expect(!r5.ok && r5.error.fieldErrors?.amount).toBeTruthy();
  });

  it('own-number airtime targets the account phone', async () => {
    const { deps } = await makeAccount(100);
    const r = await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', amount: 10, variant: 'OWN', counterparty: { phone: '0700000001' } });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.transaction.counterparty.phone).toBe('254798765432');
    expect(r.transaction.variant).toBe('OWN');
  });

  it('tokens need a device allocation (free simulations do not)', async () => {
    const { deps } = await makeAccount(1_000);
    const paid = await processSimulation(deps, sendMoney(100, { paymentMethod: 'TOKENS' }));
    expect(!paid.ok && paid.error.code).toBe('INSUFFICIENT_TOKENS');
    const free = await processSimulation(deps, sendMoney(10, { paymentMethod: 'TOKENS' }));
    expect(free.ok).toBe(true);
  });

  it('requires an account', async () => {
    const { deps } = makeDeps();
    const r = await processSimulation(deps, sendMoney(10));
    expect(!r.ok && r.error.code).toBe('NO_ACCOUNT');
  });
});

describe('idempotency (§25, §47.6)', () => {
  it('one operation ID → one transaction, movement, message, outbox entry and statement row', async () => {
    const { deps, store } = await makeAccount(10_000);
    const req = sendMoney(2_000);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => processSimulation(deps, req)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    const ids = new Set(results.map((r) => (r.ok ? r.transaction.id : '')));
    expect(ids.size).toBe(1);
    const snap = store.snapshot();
    expect(snap.transactions.filter((t) => t.operationId === req.operationId)).toHaveLength(1);
    expect(snap.movements).toHaveLength(2); // opening + this one
    expect(snap.messages).toHaveLength(1);
    expect(snap.outbox.filter((e) => e.operationId === req.operationId)).toHaveLength(1);
    expect(snap.account!.currentBalanceCache).toBe(7_967);
  });

  it('rejects an operation ID reused for a different request', async () => {
    const { deps } = await makeAccount(10_000);
    const req = sendMoney(100);
    await processSimulation(deps, req);
    const conflict = await processSimulation(deps, { ...req, amount: 200 });
    expect(!conflict.ok && conflict.error.code).toBe('OPERATION_CONFLICT');
  });
});

describe('atomicity (§11.3)', () => {
  it.each([0, 1, 2, 3, 4])('a storage failure after %i writes leaves no partial state; retry succeeds once', async (writes) => {
    const { deps, store } = await makeAccount(10_000);
    const before = store.snapshot();
    const req = sendMoney(2_000);
    store.failAfterWrites = writes;
    const failed = await processSimulation(deps, req);
    expect(!failed.ok && failed.error.code).toBe('STORAGE_FAILURE');
    expect(store.snapshot()).toEqual(before);

    store.failAfterWrites = null;
    const retried = await processSimulation(deps, req); // same operationId
    expect(retried.ok && !retried.duplicate).toBe(true);
    expect((await store.getAccount())!.currentBalanceCache).toBe(7_967);
    expect((await reconcileAccount(store)).ok).toBe(true);
  });
});

describe('persistence across restart', () => {
  it('a new store built from saved state keeps balances, records and messages', async () => {
    const { deps, store } = await makeAccount(10_000);
    await processSimulation(deps, sendMoney(2_000));
    await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 500, counterparty: {} });
    const restarted = new MemoryStore(store.snapshot());
    expect((await restarted.getAccount())!.currentBalanceCache).toBe(8_467);
    expect(await restarted.listTransactions()).toHaveLength(3);
    expect(await restarted.listMessages()).toHaveLength(2);
    expect((await reconcileAccount(restarted)).ok).toBe(true);
  });
});

describe('ledger consistency over many operations', () => {
  it('cached balance always equals the sum of movements', async () => {
    const { deps, store } = await makeAccount(50_000);
    const amounts = [1, 100, 101, 500, 501, 2_500, 3_501, 7_500, 10_001, 20_001];
    for (const a of amounts) {
      await processSimulation(deps, sendMoney(a));
      await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: a, counterparty: {} });
    }
    const report = await reconcileAccount(store);
    expect(report.issues).toEqual([]);
    const totalFees = (await store.listTransactions()).reduce((s, t) => s + t.fee, 0);
    expect(report.derivedBalance).toBe(50_000 - totalFees);
  });
});
