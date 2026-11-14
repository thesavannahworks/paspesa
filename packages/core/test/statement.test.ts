import { describe, expect, it } from 'vitest';
import { buildStatement, } from '../src';
import { makeAccount, newOp, processSimulation } from './helpers';

async function populated() {
  const ctx = await makeAccount(10_000, {}, '2026-11-10T07:00:00.000Z');
  const { deps, clock } = ctx;
  clock.set('2026-11-12T18:50:00.000Z'); // 12 Nov, 9:50 pm EAT
  await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 180, counterparty: { name: 'Emmanuel Khaemba', phone: '0759182371' } });
  clock.set('2026-11-13T03:06:00.000Z'); // 13 Nov, 6:06 am
  await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 3, counterparty: { name: 'Paskal Twoli', phone: '254119249141' } });
  clock.set('2026-11-14T05:16:00.000Z'); // 14 Nov, 8:16 am
  await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 1_000, counterparty: { name: 'Innocent Achoka', tillNumber: '6484844' } });
  await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 2_000, counterparty: { name: 'Henry Ohanga', phone: '0701033089' } });
  return ctx;
}

describe('statements derive from the ledger (§22)', () => {
  it('groups by local date, newest first, with signed amounts', async () => {
    const { store, deps } = await populated();
    const st = buildStatement(await store.listTransactions(), { utcOffsetMinutes: deps.config.utcOffsetMinutes });
    expect(st.groups.map((g) => g.heading)).toEqual(['14 November 2026', '13 November 2026', '12 November 2026', '10 November 2026']);
    const first = st.groups[0]!.rows[0]!;
    expect(first).toMatchObject({ title: 'Henry Ohanga', subtitle: '0701***089', signedAmount: -2_000, fee: 33, category: 'Customer Send Money' });
    expect(st.groups[2]!.rows[0]).toMatchObject({ title: 'Emmanuel Khaemba', subtitle: '0759***371', signedAmount: 180, time: '9:50 pm' });
  });

  it('includes the opening balance entry', async () => {
    const { store, deps } = await populated();
    const st = buildStatement(await store.listTransactions(), { utcOffsetMinutes: deps.config.utcOffsetMinutes });
    const all = st.groups.flatMap((g) => g.rows);
    expect(all.at(-1)).toMatchObject({ type: 'OPENING_BALANCE', signedAmount: 10_000 });
    expect(st.rowCount).toBe(5);
  });

  it('totals and balances reconcile with the account', async () => {
    const { store, deps } = await populated();
    const st = buildStatement(await store.listTransactions(), { utcOffsetMinutes: deps.config.utcOffsetMinutes });
    expect(st.totals).toEqual({ moneyIn: 10_180, moneyOut: 3_003, fees: 33 });
    expect(st.openingBalance).toBe(0);
    expect(st.closingBalance).toBe((await store.getAccount())!.currentBalanceCache);
    expect(st.closingBalance).toBe(10_180 - 3_003 - 33);
  });

  it('filters by date range and search (name, till, reference)', async () => {
    const { store, deps } = await populated();
    const txs = await store.listTransactions();
    const opts = { utcOffsetMinutes: deps.config.utcOffsetMinutes };
    expect(buildStatement(txs, { ...opts, fromDate: '2026-11-13', toDate: '2026-11-13' }).rowCount).toBe(1);
    expect(buildStatement(txs, { ...opts, search: 'innocent' }).rowCount).toBe(1);
    expect(buildStatement(txs, { ...opts, search: '6484844' }).rowCount).toBe(1);
    const ref = txs.find((t) => t.type === 'SEND_MONEY')!.reference;
    expect(buildStatement(txs, { ...opts, search: ref.toLowerCase() }).rowCount).toBe(1);
    expect(buildStatement(txs, { ...opts, search: 'nobody-matches' }).rowCount).toBe(0);
  });
});

describe('statement amount format', () => {
  it('matches the reference list style', async () => {
    const { formatStatementAmount } = await import('../src');
    expect(formatStatementAmount(-3)).toBe('-KSH.3');
    expect(formatStatementAmount(180)).toBe('+KSH.180');
    expect(formatStatementAmount(-2000)).toBe('-KSH.2,000');
  });
});
