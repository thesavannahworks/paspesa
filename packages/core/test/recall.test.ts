import { describe, expect, it } from 'vitest';
import { addFavourite, recallNames } from '../src';
import { makeAccount, newOp, processSimulation } from './helpers';

async function ledger() {
  const ctx = await makeAccount(10_000);
  const { deps, store } = ctx;
  await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 10, counterparty: { phone: '0111000222', name: 'Amina Wanjiru' } });
  await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 10, counterparty: { phone: '0111000222', name: 'Amina W.' } });
  await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 10, counterparty: { tillNumber: '5123456', name: 'Daniel Kiprop Mutai' } });
  await processSimulation(deps, {
    operationId: newOp(), type: 'PAYBILL', amount: 10,
    counterparty: { paybillNumber: '400200', businessName: 'Co-operative Bank Money Transfer', accountReference: 'acc1', accountName: 'Ruth Njeri Magu' },
  });
  return { deps, store, txs: await store.listTransactions(), favs: await store.listFavourites() };
}

describe('recallNames (names come only from the local ledger/favourites)', () => {
  it('Send Money: latest name used for that number, any phone format', async () => {
    const { txs, favs } = await ledger();
    expect(recallNames('SEND_MONEY', { phone: '254111000222' }, txs, favs)).toEqual({ name: 'Amina W.' });
    expect(recallNames('SEND_MONEY', { phone: '0700000001' }, txs, favs)).toEqual({});
  });

  it('Pochi falls back to a Send Money name for the same number', async () => {
    const { txs, favs } = await ledger();
    expect(recallNames('POCHI', { phone: '0111000222' }, txs, favs).name).toBe('Amina W.');
  });

  it('Buy Goods by till; Paybill business by number and account name by number + account (case-insensitive)', async () => {
    const { txs, favs } = await ledger();
    expect(recallNames('BUY_GOODS', { tillNumber: '5123456' }, txs, favs)).toEqual({ name: 'Daniel Kiprop Mutai' });
    expect(recallNames('PAYBILL', { paybillNumber: '400200' }, txs, favs)).toEqual({ businessName: 'Co-operative Bank Money Transfer' });
    expect(recallNames('PAYBILL', { paybillNumber: '400200', accountReference: 'ACC1' }, txs, favs)).toEqual({
      businessName: 'Co-operative Bank Money Transfer', accountName: 'Ruth Njeri Magu',
    });
    expect(recallNames('PAYBILL', { paybillNumber: '400200', accountReference: 'other' }, txs, favs).accountName).toBeUndefined();
  });

  it('a manual favourite wins over older ledger names', async () => {
    const { deps, store } = await ledger();
    await addFavourite(deps, { type: 'SEND_MONEY', counterparty: { phone: '0111000222', name: 'Brian (fav)' } });
    const names = recallNames('SEND_MONEY', { phone: '0111000222' }, await store.listTransactions(), await store.listFavourites());
    expect(names.name).toBe('Brian (fav)');
  });
});
