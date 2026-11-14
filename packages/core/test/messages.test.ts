import { describe, expect, it } from 'vitest';
import {
  MESSAGE_TEMPLATES,
  REFERENCE_PATTERN,
  findTemplate,
  messageVariables,
  referencePrefix,
  renderTemplate,
  toLocalParts,
  type TransactionRecord,
} from '../src';
import { makeAccount, newOp, processSimulation } from './helpers';

const base: TransactionRecord = {
  id: 't1', accountId: 'a1', operationId: 'o1', reference: 'UKELA1SOZG', sequence: 2,
  type: 'SEND_MONEY', variant: null, direction: 'DEBIT', status: 'SUCCESSFUL',
  amount: 1, fee: 0, totalDebit: 1, balanceBefore: 27, balanceAfter: 26, airtimeBalanceAfter: null,
  counterparty: { name: 'Paskal Twoli', phone: '254119249141' },
  source: 'TRANSACTION', feeScheduleId: 'SEND_MONEY', feeScheduleVersion: 1, configVersion: 1,
  paymentMethod: 'UNMETERED', pricing: null, requestFingerprint: '',
  createdAt: '2026-11-14T07:55:00.000Z', completedAt: '2026-11-14T07:55:00.000Z',
  syncStatus: 'PENDING', payloadVersion: 1,
};

const render = (tx: TransactionRecord) =>
  renderTemplate(findTemplate(tx.type, tx.variant)!, messageVariables(tx, 180));

describe('message templates match the supplied reference structure', () => {
  it('Send Money', () => {
    expect(render(base)).toBe(
      'UKELA1SOZG Confirmed. Ksh1.00 sent to PASKAL TWOLI 0119249141 on 14/11/26 at 10:55 AM. New M-PESA balance is Ksh26.00. Transaction cost, Ksh0.00.',
    );
  });
  it('Pochi la Biashara (no phone in message)', () => {
    expect(render({ ...base, type: 'POCHI', reference: 'UKELA1SUXR', completedAt: '2026-11-14T08:02:00.000Z', amount: 2, balanceAfter: 24 })).toBe(
      'UKELA1SUXR Confirmed. Ksh2.00 sent to PASKAL TWOLI on 14/11/26 at 11:02 AM. New M-PESA balance is Ksh24.00. Transaction cost, Ksh0.00.',
    );
  });
  it('Buy Goods', () => {
    expect(render({ ...base, type: 'BUY_GOODS', reference: 'UKELA1S2AK', completedAt: '2026-11-14T05:16:00.000Z', balanceAfter: 27, counterparty: { name: 'Innocent Wafula Achoka', tillNumber: '6484844' } })).toBe(
      'UKELA1S2AK Confirmed. Ksh1.00 paid to INNOCENT WAFULA ACHOKA. on 14/11/26 at 8:16 AM.New M-PESA balance is Ksh27.00. Transaction cost, Ksh0.00.',
    );
  });
  it('Paybill', () => {
    expect(render({ ...base, type: 'PAYBILL', reference: 'UKELA1SVEA', completedAt: '2026-11-14T08:24:00.000Z', balanceAfter: 20, counterparty: { businessName: 'Co-operative Bank Money Transfer', paybillNumber: '400200', accountReference: '4001077' } })).toBe(
      'UKELA1SVEA Confirmed. Ksh1.00 sent to Co-operative Bank Money Transfer for account 4001077 on 14/11/26 at 11:24 AM New M-PESA balance is Ksh20.00. Transaction cost, Ksh0.00.',
    );
  });
  it('Airtime — own and other number', () => {
    const own = { ...base, type: 'AIRTIME' as const, variant: 'OWN', reference: 'UKELA1SR5M', completedAt: '2026-11-14T08:34:00.000Z', balanceAfter: 18, counterparty: { phone: '254759981287' } };
    expect(render(own)).toBe('UKELA1SR5M confirmed.You bought Ksh1.00 of airtime on 14/11/26 at 11:34 AM.New M-PESA balance is Ksh18.00. Transaction cost, Ksh0.00.');
    const other = { ...own, variant: 'OTHER', reference: 'UKELA1SOJB', completedAt: '2026-11-14T08:33:00.000Z', balanceAfter: 19, counterparty: { phone: '254119249141' } };
    expect(render(other)).toBe('UKELA1SOJB confirmed.You bought Ksh1.00 of airtime for 254119249141 on 14/11/26 at 11:33 AM.New balance is Ksh19.00. Transaction cost, Ksh0.00.');
  });
  it('Recharge uses the incoming-money structure with a masked phone', () => {
    const tx = { ...base, type: 'RECHARGE' as const, direction: 'CREDIT' as const, reference: 'UKC2Z27DK3', amount: 700, totalDebit: 0, balanceAfter: 25_071, completedAt: '2026-11-12T09:51:00.000Z', counterparty: { name: 'Protas Juma', phone: '254726123928' } };
    expect(render(tx)).toBe('UKC2Z27DK3 Confirmed.You have received Ksh700.00 from PROTAS JUMA 0726***928 on 12/11/26 at 12:51 PM New M-PESA balance is Ksh25,071.00.');
  });
  it('every template only uses known placeholders', () => {
    for (const t of MESSAGE_TEMPLATES) {
      const tx = { ...base, type: t.transactionType, variant: t.variant };
      expect(() => renderTemplate(t, messageVariables(tx, 180))).not.toThrow();
    }
  });
  it('withdraw template is flagged PROVISIONAL until a reference is supplied', () => {
    expect(findTemplate('WITHDRAW', null)!.status).toBe('PROVISIONAL');
  });
});

describe('message consistency with the committed record (§19.3)', () => {
  it('message values equal the saved transaction values', async () => {
    const { deps, store } = await makeAccount(10_000);
    const r = await processSimulation(deps, { operationId: newOp(), type: 'SEND_MONEY', amount: 2_000, counterparty: { name: 'Henry Ohanga', phone: '0701033089' } });
    if (!r.ok) throw new Error(r.error.message);
    const msg = (await store.getMessageByTransactionId(r.transaction.id))!;
    expect(msg.body).toContain(r.transaction.reference);
    expect(msg.body).toContain('Ksh2,000.00 sent to HENRY OHANGA 0701033089');
    expect(msg.body).toContain('New M-PESA balance is Ksh7,967.00');
    expect(msg.body).toContain('Transaction cost, Ksh33.00');
    expect(msg.transactionId).toBe(r.transaction.id);
  });
});

describe('transaction reference', () => {
  it('encodes year/month/day like the supplied references', () => {
    expect(referencePrefix(toLocalParts('2026-11-14T05:00:00Z', 180))).toBe('UKE');
    expect(referencePrefix(toLocalParts('2026-11-13T05:00:00Z', 180))).toBe('UKD');
    expect(referencePrefix(toLocalParts('2026-11-12T05:00:00Z', 180))).toBe('UKC');
    expect(referencePrefix(toLocalParts('2026-01-05T05:00:00Z', 180))).toBe('UA5');
    expect(referencePrefix(toLocalParts('2026-12-31T05:00:00Z', 180))).toBe('ULV');
  });
  it('uses Kenya local date (23:30 UTC is the next day in EAT)', () => {
    expect(referencePrefix(toLocalParts('2026-11-13T23:30:00Z', 180))).toBe('UKE');
  });
  it('generated references are valid and unique', async () => {
    const { deps, store } = await makeAccount(100_000);
    for (let i = 0; i < 50; i++) {
      await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 1, counterparty: {} });
    }
    const refs = (await store.listTransactions()).map((t) => t.reference);
    expect(new Set(refs).size).toBe(refs.length);
    refs.forEach((r) => expect(r).toMatch(REFERENCE_PATTERN));
  });
});
