import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  addFavourite,
  favouritesFor,
  formatConfirmTransactionCost,
  processSimulation as coreProcess,
  reconcileAccount,
  removeFavourite,
  resetAirtimeBalance,
  setPin,
  setupAccount,
  updateRechargeSenderDefaults,
} from '../src';
import { TEST_PIN, makeAccount, makeDeps, newOp, processSimulation } from './helpers';

describe('simulated Paspesa PIN', () => {
  it('USER_PIN (default): correct PIN commits, wrong PIN changes nothing', async () => {
    const { deps, store } = await makeAccount(1_000);
    expect(DEFAULT_CONFIG.pinMode).toBe('USER_PIN');
    const before = store.snapshot();
    const wrong = await coreProcess(deps, { operationId: newOp(), type: 'RECHARGE', amount: 10, counterparty: {}, pin: '9999' });
    expect(!wrong.ok && wrong.error.code).toBe('WRONG_PIN');
    // Nothing changes except the wrong-PIN notice in Messages.
    const after = store.snapshot();
    expect({ ...after, messages: [] }).toEqual({ ...before, messages: [] });
    expect(after.messages.map((m) => [m.category, m.body])).toEqual([['SYSTEM_NOTICE', 'You have entered the wrong PIN. Please try again.']]);
    const right = await coreProcess(deps, { operationId: newOp(), type: 'RECHARGE', amount: 10, counterparty: {}, pin: TEST_PIN });
    expect(right.ok).toBe(true);
  });

  it('PIN is never stored in clear text', async () => {
    const { store } = await makeAccount(1_000);
    const account = (await store.getAccount())!;
    expect(Object.keys(account.pin!).sort()).toEqual(['hash', 'salt']);
    expect(account.pin!.hash).not.toBe(TEST_PIN);
    // The only place a PIN could appear is the account; no transaction/outbox record carries it.
    const { account: _a, ...rest } = store.snapshot();
    expect(JSON.stringify(rest)).not.toContain(TEST_PIN);
  });

  it('setup requires a 4-digit PIN under USER_PIN', async () => {
    const { deps } = makeDeps();
    const res = await setupAccount(deps, { operationId: 's', accountName: 'A', phoneNumber: '0712345678', openingBalance: 0, pin: '12' });
    expect(!res.ok && res.error.fieldErrors?.pin).toBeTruthy();
  });

  it('ANY_PIN (back-office option): any 4 digits accepted, nothing stored', async () => {
    const config = { ...DEFAULT_CONFIG, pinMode: 'ANY_PIN' as const };
    const { deps, store } = makeDeps({ config });
    await setupAccount(deps, { operationId: 's', accountName: 'A', phoneNumber: '0712345678', openingBalance: 100 });
    expect((await store.getAccount())!.pin).toBeNull();
    const ok = await coreProcess(deps, { operationId: newOp(), type: 'RECHARGE', amount: 1, counterparty: {}, pin: '0000' });
    expect(ok.ok).toBe(true);
    const bad = await coreProcess(deps, { operationId: newOp(), type: 'RECHARGE', amount: 1, counterparty: {}, pin: '12a4' });
    expect(!bad.ok && bad.error.code).toBe('WRONG_PIN');
  });

  it('switching ANY_PIN → USER_PIN asks the user to set a PIN; changing a PIN requires the current one', async () => {
    const anyCfg = { ...DEFAULT_CONFIG, pinMode: 'ANY_PIN' as const };
    const ctx = makeDeps({ config: anyCfg });
    await setupAccount(ctx.deps, { operationId: 's', accountName: 'A', phoneNumber: '0712345678', openingBalance: 100 });
    const userDeps = { ...ctx.deps, config: DEFAULT_CONFIG };
    const notSet = await coreProcess(userDeps, { operationId: newOp(), type: 'RECHARGE', amount: 1, counterparty: {}, pin: '1111' });
    expect(!notSet.ok && notSet.error.code).toBe('PIN_NOT_SET');
    expect((await setPin(userDeps, { newPin: '2468' })).ok).toBe(true);
    expect((await setPin(userDeps, { newPin: '1357', currentPin: '0000' })).ok).toBe(false);
    expect((await setPin(userDeps, { newPin: '1357', currentPin: '2468' })).ok).toBe(true);
    expect((await coreProcess(userDeps, { operationId: newOp(), type: 'RECHARGE', amount: 1, counterparty: {}, pin: '1357' })).ok).toBe(true);
  });
});

describe('simulated airtime balance (cap KSh 1,000)', () => {
  it('own-number airtime raises the airtime balance; other-number does not', async () => {
    const { deps, store } = await makeAccount(5_000);
    const own = await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 300, counterparty: {} });
    const other = await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OTHER', amount: 200, counterparty: { phone: '0712345678' } });
    expect(own.ok && own.transaction.airtimeBalanceAfter).toBe(300);
    expect(other.ok && other.transaction.airtimeBalanceAfter).toBeNull();
    const account = (await store.getAccount())!;
    expect(account.airtimeBalance).toBe(300);
    expect(account.currentBalanceCache).toBe(4_500);
    expect((await reconcileAccount(store)).ok).toBe(true);
  });

  it('rejects an own-number top-up that would exceed KSh 1,000; exactly 1,000 is allowed', async () => {
    const { deps, store } = await makeAccount(5_000);
    await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 900, counterparty: {} });
    const over = await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 101, counterparty: {} });
    expect(!over.ok && over.error.code).toBe('AIRTIME_BALANCE_LIMIT');
    const exact = await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 100, counterparty: {} });
    expect(exact.ok && exact.account.airtimeBalance).toBe(1_000);
    expect((await store.getAccount())!.currentBalanceCache).toBe(4_000);
  });
});

describe('airtime balance reset (interim, until airtime has a use)', () => {
  it('zeroes the airtime balance only, allows topping up again, and stays reconcilable', async () => {
    const { deps, store } = await makeAccount(5_000);
    await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 1_000, counterparty: {} });
    const blocked = await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 1, counterparty: {} });
    expect(!blocked.ok && blocked.error.code).toBe('AIRTIME_BALANCE_LIMIT');

    const txBefore = (await store.listTransactions()).length;
    const reset = await resetAirtimeBalance(deps);
    expect(reset.ok && reset.amountReset).toBe(1_000);
    const account = (await store.getAccount())!;
    expect(account).toMatchObject({ airtimeBalance: 0, airtimeResetTotal: 1_000, currentBalanceCache: 4_000 });
    expect((await store.listTransactions()).length).toBe(txBefore);
    expect((await reconcileAccount(store)).issues).toEqual([]);

    const again = await processSimulation(deps, { operationId: newOp(), type: 'AIRTIME', variant: 'OWN', amount: 250, counterparty: {} });
    expect(again.ok && again.account.airtimeBalance).toBe(250);
    expect((await reconcileAccount(store)).issues).toEqual([]);
  });
  it('resetting a zero balance is a no-op', async () => {
    const { deps } = await makeAccount(0);
    const r = await resetAirtimeBalance(deps);
    expect(r.ok && r.amountReset).toBe(0);
  });
});

describe('user-configurable recharge sender defaults', () => {
  it('overrides the Paspesa default for later recharges and can be reset', async () => {
    const { deps } = await makeAccount(0);
    expect((await updateRechargeSenderDefaults(deps, { name: 'Mum', phone: '0722000111' })).ok).toBe(true);
    const r1 = await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 100, counterparty: {} });
    expect(r1.ok && r1.transaction.counterparty).toEqual({ name: 'Mum', phone: '254722000111' });
    await updateRechargeSenderDefaults(deps, null);
    const r2 = await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 100, counterparty: {} });
    expect(r2.ok && r2.transaction.counterparty).toEqual(DEFAULT_CONFIG.defaultRechargeSender);
  });
  it('validates the sender phone', async () => {
    const { deps } = await makeAccount(0);
    const r = await updateRechargeSenderDefaults(deps, { name: 'X', phone: '123' });
    expect(!r.ok && r.error.fieldErrors?.phone).toBeTruthy();
  });
  it('settings changes never touch the ledger', async () => {
    const { deps, store } = await makeAccount(500);
    const before = store.snapshot();
    await updateRechargeSenderDefaults(deps, { name: 'Mum', phone: '0722000111' });
    const after = store.snapshot();
    expect(after.transactions).toEqual(before.transactions);
    expect(after.movements).toEqual(before.movements);
    expect(after.account!.currentBalanceCache).toBe(500);
  });
});

describe('confirm-screen transaction cost (simulated M-PESA fee)', () => {
  it('shows N/A when the fee is zero, else the amount', () => {
    expect(formatConfirmTransactionCost(0)).toBe('N/A');
    expect(formatConfirmTransactionCost(33)).toBe('Ksh 33.00');
  });
});

describe('favourites = manual ∪ frequent', () => {
  it('a recipient used 3+ times becomes a favourite automatically; manual ones always appear', async () => {
    const { deps, store } = await makeAccount(50_000);
    const send = (name: string, phone: string) =>
      processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 50, counterparty: { name, phone } });
    for (let i = 0; i < 3; i++) await send('Henry Ohanga', '0701033089');
    await send('Once Only', '0711111111');
    const manual = await addFavourite(deps, { type: 'SEND_MONEY', counterparty: { name: 'Aga Cotu', phone: '0799999999' } });
    expect(manual.ok).toBe(true);

    const list = favouritesFor(['SEND_MONEY'], await store.listFavourites(), await store.listTransactions(), DEFAULT_CONFIG.frequentThreshold);
    expect(list.map((f) => [f.label, f.origin])).toEqual([
      ['Aga Cotu', 'MANUAL'],
      ['Henry Ohanga', 'FREQUENT'],
    ]);
    expect(list[1]!.useCount).toBe(3);

    await removeFavourite(deps, (manual as { favourite: { id: string } }).favourite.id);
    expect(await store.listFavourites()).toHaveLength(0);
  });
  it('paybill favourites are keyed by paybill + account number', async () => {
    const { deps, store } = await makeAccount(50_000);
    for (const acc of ['A1', 'A1', 'A1', 'B2']) {
      await processSimulation(deps, { operationId: newOp(), type: 'PAYBILL', amount: 10, counterparty: { paybillNumber: '400200', businessName: 'Co-op', accountReference: acc } });
    }
    const list = favouritesFor(['PAYBILL'], [], await store.listTransactions(), 3);
    expect(list).toHaveLength(1);
    expect(list[0]!.counterparty.accountReference).toBe('A1');
  });
});
