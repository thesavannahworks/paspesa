import { describe, expect, it } from 'vitest';
import { encodePaymentQr, parsePaymentQr } from '../src';

describe('Paspesa payment QR', () => {
  it('round-trips a Send Money code with a name that needs escaping, with and without amount', () => {
    const p = { type: 'SEND_MONEY' as const, counterparty: { phone: '254759981287', name: 'Paskal & Co = Twoli' } };
    expect(parsePaymentQr(encodePaymentQr(p))).toEqual(p);
    expect(parsePaymentQr(encodePaymentQr({ ...p, amount: 250 }))).toEqual({ ...p, amount: 250 });
  });

  it('round-trips Buy Goods and Paybill codes', () => {
    const till = { type: 'BUY_GOODS' as const, counterparty: { tillNumber: '6484844', name: 'Innocent Wafula Achoka' } };
    const bill = { type: 'PAYBILL' as const, counterparty: { paybillNumber: '400200', businessName: 'Co-op', accountReference: 'A1' } };
    expect(parsePaymentQr(encodePaymentQr(till))).toEqual(till);
    expect(parsePaymentQr(encodePaymentQr(bill))).toEqual(bill);
  });

  it('rejects foreign or malformed codes', () => {
    expect(parsePaymentQr('https://example.com')).toBeNull();
    expect(parsePaymentQr('exp://192.168.1.107:8081')).toBeNull();
    expect(parsePaymentQr('paspesa://pay?v=2&t=sm&p=254759981287')).toBeNull();
    expect(parsePaymentQr('paspesa://pay?v=1&t=sm&p=123')).toBeNull();
    expect(parsePaymentQr('paspesa://pay?v=1&t=bg&ti=12')).toBeNull();
    expect(parsePaymentQr('paspesa://pay?v=1&t=sm&p=254759981287&a=-5')).toBeNull();
    expect(parsePaymentQr('paspesa://pay?v=1&t=sm&p=254759981287&a=1.5')).toBeNull();
    expect(parsePaymentQr('paspesa://pay?v=1&t=sm&p=254759981287&n=%E0%A4%A')).toBeNull();
  });
});
