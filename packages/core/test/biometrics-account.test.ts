import { describe, expect, it } from 'vitest';
import { processSimulation as coreProcess, updateAccountDetails, verifyPin } from '../src';
import { TEST_PIN, makeAccount, newOp, processSimulation } from './helpers';

describe('biometric approval', () => {
  it('a biometric approval commits without a PIN', async () => {
    const { deps } = await makeAccount(1_000);
    const r = await coreProcess(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 10, counterparty: { tillNumber: '453851', name: 'Shop' }, authMethod: 'BIOMETRIC' });
    expect(r.ok).toBe(true);
  });

  it('without biometrics a missing PIN is still rejected', async () => {
    const { deps } = await makeAccount(1_000);
    const r = await coreProcess(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 10, counterparty: { tillNumber: '453851', name: 'Shop' } });
    expect(!r.ok && r.error.code).toBe('WRONG_PIN');
  });

  it('verifyPin checks the PIN and changes nothing', async () => {
    const { deps, store } = await makeAccount(1_000);
    const before = store.snapshot();
    expect((await verifyPin(deps, TEST_PIN)).ok).toBe(true);
    const wrong = await verifyPin(deps, '9999');
    expect(!wrong.ok && wrong.error.code).toBe('WRONG_PIN');
    expect(store.snapshot()).toEqual(before);
  });
});

describe('editing the setup details', () => {
  it('updates name and phone; history keeps its values; opening balance untouched', async () => {
    const { deps, store } = await makeAccount(5_000);
    await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 10, counterparty: { tillNumber: '453851', name: 'Shop' } });
    const txBefore = await store.listTransactions();
    const res = await updateAccountDetails(deps, { accountName: '  Brian   Otieno ', phoneNumber: '0111 000 222' });
    if (!res.ok) throw new Error(res.error.message);
    const account = (await store.getAccount())!;
    expect(account.accountName).toBe('Brian Otieno');
    expect(account.phoneNumber).toBe('254111000222');
    expect(account.openingBalance).toBe(5_000);
    expect(account.currentBalanceCache).toBe(4_990);
    expect(await store.listTransactions()).toEqual(txBefore);
  });

  it('validates like setup', async () => {
    const { deps } = await makeAccount(5_000);
    const res = await updateAccountDetails(deps, { accountName: ' ', phoneNumber: '123' });
    expect(!res.ok && res.error.fieldErrors).toEqual({ accountName: 'Name is required', phoneNumber: 'Enter a valid Kenyan mobile number' });
  });
});
