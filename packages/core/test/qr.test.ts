import { describe, expect, it } from 'vitest';
import { crc16, encodePaymentQr, parsePaymentQr } from '../src';

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

  it('reads M-PESA EMVCo codes: till, paybill with account, phone, amount', () => {
    const f = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;
    const emv = (...fields: string[]) => {
      const body = f('00', '01') + f('01', '11') + fields.join('') + f('53', '404') + f('58', 'KE') + '6304';
      return body + crc16(body);
    };
    const mpesa = (...sub: string[]) => f('29', f('00', 'ke.co.safaricom.mpesa') + sub.join(''));

    expect(parsePaymentQr(emv(mpesa(f('01', '453851')), f('59', 'BEREA SHOP8'), f('60', 'NAIROBI')))).toEqual({
      type: 'BUY_GOODS', source: 'MPESA', counterparty: { tillNumber: '453851', name: 'BEREA SHOP8' },
    });
    expect(parsePaymentQr(emv(mpesa(f('01', '4008951')), f('54', '130.00'), f('59', 'LIPAKITU LIMITED'), f('62', f('01', '1780'))))).toEqual({
      type: 'PAYBILL', source: 'MPESA', amount: 130, counterparty: { paybillNumber: '4008951', businessName: 'LIPAKITU LIMITED', accountReference: '1780' },
    });
    expect(parsePaymentQr(emv(mpesa(f('02', 'PAYBILL'), f('01', '400200')), f('59', 'CO-OP')))).toMatchObject({ type: 'PAYBILL', counterparty: { paybillNumber: '400200' } });
    expect(parsePaymentQr(emv(mpesa(f('01', '254180354207')), f('59', "RACHAEL NDUNG'U")))).toMatchObject({ type: 'SEND_MONEY', counterparty: { phone: '254180354207' } });
    // cents are not simulated: the amount is left for the user to type
    expect(parsePaymentQr(emv(mpesa(f('01', '453851')), f('54', '99.50')))?.amount).toBeUndefined();
  });

  it('reads the Daraja key/value form', () => {
    expect(parsePaymentQr('TrxCode=BG&CPI=373132&Amount=100&MerchantName=TEST%20SHOP')).toEqual({
      type: 'BUY_GOODS', source: 'MPESA', amount: 100, counterparty: { tillNumber: '373132', name: 'TEST SHOP' },
    });
    expect(parsePaymentQr('{"TrxCode":"PB","CPI":"400200","RefNo":"A1","Amount":50}')).toMatchObject({ type: 'PAYBILL', counterparty: { paybillNumber: '400200', accountReference: 'A1' } });
    expect(parsePaymentQr('TrxCode=WA&CPI=373132')).toBeNull();
  });

  it('rejects EMVCo codes from other countries and broken payloads', () => {
    const f = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;
    expect(parsePaymentQr(f('00', '01') + f('29', f('00', 'x') + f('01', '453851')) + f('53', '764') + f('58', 'TH'))).toBeNull();
    expect(parsePaymentQr('000201' + '2999abc')).toBeNull();
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
