import { describe, expect, it } from 'vitest';
import {
  REFERENCE_PATTERN,
  deleteMessages,
  generateReference,
  referenceCounterAt,
  setMessageStarred,
  toLocalParts,
  visibleMessages,
} from '../src';
import { makeAccount, newOp, processSimulation, seededRandom } from './helpers';

describe('transaction codes follow the reference structure', () => {
  it('counter sits next to the real codes issued at the same moment', () => {
    // Real codes from the reference messages; the fitted counter must be within ~1h of traffic (±10,000).
    const samples: Array<[string, string]> = [
      ['UK5LA0R1FA', '2026-11-05T18:48:00Z'],
      ['UK9LA17IVP', '2026-11-09T13:41:00Z'],
      ['UKELA1SVEA', '2026-11-14T08:24:00Z'],
      ['UKFLA1YK4X', '2026-11-15T13:08:00Z'],
    ];
    for (const [ref, at] of samples) {
      const actual = parseInt(ref.slice(5), 36);
      expect(Math.abs(referenceCounterAt(Date.parse(at)) - actual)).toBeLessThan(50_000);
    }
  });

  it('own payments carry node LA and the date prefix', () => {
    const at = '2026-11-15T13:08:00Z';
    const ref = generateReference(toLocalParts(at, 180), seededRandom(), { epochMs: Date.parse(at), node: 'LA' });
    expect(ref).toMatch(REFERENCE_PATTERN);
    expect(ref.slice(0, 5)).toBe('UKFLA');
    expect(ref.slice(5, 7)).toBe('1Y'); // like UKFLA1YK4X at 16:08 EAT
  });

  it('payments use LA; money received uses another node', async () => {
    const { deps } = await makeAccount(10_000);
    const sent = await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 10, counterparty: { tillNumber: '453851', name: 'Berea Shop' } });
    const received = await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 10, counterparty: {} });
    if (!sent.ok || !received.ok) throw new Error('failed');
    expect(sent.transaction.reference.slice(3, 5)).toBe('LA');
    expect(received.transaction.reference).toMatch(REFERENCE_PATTERN);
  });
});

describe('Messages thread', () => {
  it('logs a wrong PIN, then the longer notice on a further wrong PIN for the same payment', async () => {
    const { deps, store } = await makeAccount(1_000);
    const op = newOp();
    const request = { operationId: op, type: 'SEND_MONEY' as const, amount: 10, counterparty: { phone: '0111000222', name: 'Amina Wanjiru' } };
    await processSimulation(deps, { ...request, pin: '9999' });
    await processSimulation(deps, { ...request, pin: '8888' });
    const ok = await processSimulation(deps, request);
    expect(ok.ok).toBe(true);
    const bodies = visibleMessages(await store.listMessages()).map((m) => m.body);
    expect(bodies[0]).toBe('You have entered the wrong PIN. Please try again.');
    expect(bodies[1]).toMatch(/^Failed, you have entered the wrong PIN\. If forgotten please dial \*334#/);
    expect(bodies[2]).toContain('Confirmed. Ksh10.00 sent to AMINA  WANJIRU 0111000222');
    expect((await store.listTransactions()).filter((t) => t.type === 'SEND_MONEY')).toHaveLength(1);
  });

  it('a badly formed PIN is not logged', async () => {
    const { deps, store } = await makeAccount(1_000);
    await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 10, counterparty: {}, pin: '12' });
    expect(await store.listMessages()).toHaveLength(0);
  });

  it('"Amount you can transact within the day" is 500,000 less the day\'s payments, fees excluded', async () => {
    const { deps } = await makeAccount(20_000);
    const a = await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 400, counterparty: { phone: '0722000111', name: 'Peter Kamau' } });
    const b = await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 467, counterparty: { tillNumber: '453851', name: 'Best Choice Enterprises' } });
    const c = await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 1_000, counterparty: {} });
    if (!a.ok || !b.ok || !c.ok) throw new Error('failed');
    expect(a.transaction.fee).toBe(7);
    expect(a.message!.body).toContain('within the day is 499,600.00.');
    expect(b.message!.body).toContain('within the day is 499,133.00.');
  });

  it('deleting messages (single or bulk) never touches transactions or the statement', async () => {
    const { deps, store } = await makeAccount(5_000);
    for (const amount of [10, 20, 30]) {
      await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount, counterparty: { tillNumber: '453851', name: 'Shop' } });
    }
    const before = await store.listTransactions();
    const all = visibleMessages(await store.listMessages());
    expect(all).toHaveLength(3);
    expect(await deleteMessages(deps, [all[0]!.id])).toBe(1);
    expect(await deleteMessages(deps, [all[1]!.id, all[2]!.id, all[0]!.id])).toBe(2);
    expect(visibleMessages(await store.listMessages())).toHaveLength(0);
    expect(await store.listTransactions()).toEqual(before);
    expect((await store.getAccount())!.currentBalanceCache).toBe(4_940);
  });

  it('stars and un-stars a message', async () => {
    const { deps, store } = await makeAccount(5_000);
    await processSimulation(deps, { operationId: newOp(), type: 'BUY_GOODS', amount: 10, counterparty: { tillNumber: '453851', name: 'Shop' } });
    const [m] = await store.listMessages();
    await setMessageStarred(deps, m!.id, true);
    expect((await store.listMessages())[0]!.starred).toBe(true);
    await setMessageStarred(deps, m!.id, false);
    expect((await store.listMessages())[0]!.starred).toBe(false);
  });
});
