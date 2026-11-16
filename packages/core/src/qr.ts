/**
 * Paspesa payment QR codes (Scan to Pay / My QR).
 *
 * Format: `paspesa://pay?v=1&t=<type>&...` with URL-encoded fields. Only Paspesa's own codes are
 * understood; real M-PESA/merchant QR codes are not decoded (no real payment data is used).
 */
import { normalizeKenyanPhone } from './phone';
import type { CounterpartyInput } from './catalogue';
import type { SimulationType } from './types';

export type QrPaymentType = Extract<SimulationType, 'SEND_MONEY' | 'POCHI' | 'BUY_GOODS' | 'PAYBILL'>;

export interface QrPayment {
  type: QrPaymentType;
  counterparty: CounterpartyInput;
  /** Requested amount in whole shillings, when the code carries one. */
  amount?: number;
}

const PREFIX = 'paspesa://pay?';
const TYPE_CODES: Record<QrPaymentType, string> = { SEND_MONEY: 'sm', POCHI: 'po', BUY_GOODS: 'bg', PAYBILL: 'pb' };
const FIELDS: Array<[keyof CounterpartyInput, string]> = [
  ['phone', 'p'], ['name', 'n'], ['tillNumber', 'ti'], ['paybillNumber', 'pb'],
  ['businessName', 'bn'], ['accountReference', 'ac'], ['accountName', 'an'],
];

export function encodePaymentQr(payment: QrPayment): string {
  const parts = [`v=1`, `t=${TYPE_CODES[payment.type]}`];
  for (const [field, key] of FIELDS) {
    const value = payment.counterparty[field];
    if (value) parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  if (payment.amount !== undefined) parts.push(`a=${payment.amount}`);
  return PREFIX + parts.join('&');
}

/** Returns null for anything that is not a well-formed Paspesa payment code. */
export function parsePaymentQr(data: string): QrPayment | null {
  const text = data.trim();
  if (!text.startsWith(PREFIX)) return null;
  const params = new Map<string, string>();
  for (const pair of text.slice(PREFIX.length).split('&')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    try {
      params.set(pair.slice(0, i), decodeURIComponent(pair.slice(i + 1)));
    } catch {
      return null;
    }
  }
  if (params.get('v') !== '1') return null;
  const type = (Object.keys(TYPE_CODES) as QrPaymentType[]).find((t) => TYPE_CODES[t] === params.get('t'));
  if (!type) return null;

  const counterparty: CounterpartyInput = {};
  for (const [field, key] of FIELDS) {
    const value = params.get(key);
    if (value) counterparty[field] = value.slice(0, 80);
  }
  if ((type === 'SEND_MONEY' || type === 'POCHI') && !normalizeKenyanPhone(counterparty.phone ?? '')) return null;
  if (type === 'BUY_GOODS' && !/^\d{5,8}$/.test(counterparty.tillNumber ?? '')) return null;
  if (type === 'PAYBILL' && !/^\d{5,7}$/.test(counterparty.paybillNumber ?? '')) return null;

  const result: QrPayment = { type, counterparty };
  const a = params.get('a');
  if (a !== undefined) {
    if (!/^\d{1,6}$/.test(a) || Number(a) <= 0) return null;
    result.amount = Number(a);
  }
  return result;
}
