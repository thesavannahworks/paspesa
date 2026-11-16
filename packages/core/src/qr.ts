/**
 * Payment QR codes for Scan to Pay / My QR.
 *
 * Two families are understood:
 *  1. Paspesa's own codes (My QR): `paspesa://pay?v=1&t=<type>&...` with URL-encoded fields.
 *  2. M-PESA codes (shop stickers, M-PESA app QR): EMVCo merchant-presented TLV payloads
 *     ("000201...5303404...5802KE...6304xxxx") and the Daraja key/value form (TrxCode=BG&CPI=...).
 *     Only the till / paybill / phone number, name and amount are read, to pre-fill a SIMULATED
 *     payment. Nothing reaches the real recipient (White Paper 5.1).
 */
import { normalizeKenyanPhone } from './phone';
import type { CounterpartyInput } from './catalogue';
import type { SimulationType } from './types';

export type QrPaymentType = Extract<SimulationType, 'SEND_MONEY' | 'POCHI' | 'BUY_GOODS' | 'PAYBILL'>;

export interface QrPayment {
  type: QrPaymentType;
  /** Set for codes that came from M-PESA rather than Paspesa's My QR. */
  source?: 'MPESA';
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

/** Returns null for anything that is not a recognisable Paspesa or M-PESA payment code. */
export function parsePaymentQr(data: string): QrPayment | null {
  const text = data.trim();
  return parsePaspesaQr(text) ?? parseEmvQr(text) ?? parseKeyValueQr(text);
}

function parsePaspesaQr(text: string): QrPayment | null {
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

// ---------------------------------------------------------------------------------------------
// M-PESA: EMVCo merchant-presented mode
// ---------------------------------------------------------------------------------------------

const MAX_QR_AMOUNT = 250_000;

/** Parses "TTLLvalue…" (2-digit tag, 2-digit length). Returns null if the structure is broken. */
export function parseTlv(text: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < text.length) {
    const tag = text.slice(i, i + 2);
    const len = text.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(len)) return null;
    const value = text.slice(i + 4, i + 4 + Number(len));
    if (value.length !== Number(len)) return null;
    if (!out.has(tag)) out.set(tag, value);
    i += 4 + Number(len);
  }
  return out;
}

/** CRC-16/CCITT-FALSE as used by EMVCo QR (tag 63). */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

type Hint = QrPaymentType | null;

/** What kind of payment a merchant-account template describes, from its identifiers. */
function hintFrom(text: string): Hint {
  const t = text.toLowerCase();
  if (/pay ?bill|business ?number|\bpb\b/.test(t)) return 'PAYBILL';
  if (/till|buy ?goods|merchant|\bbg\b/.test(t)) return 'BUY_GOODS';
  if (/pochi|\bsb\b/.test(t)) return 'POCHI';
  if (/send ?money|p2p|\bsm\b/.test(t)) return 'SEND_MONEY';
  return null;
}

/** Whole-shilling amount, or undefined when absent, with cents, or out of range. */
function wholeAmount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m || (m[2] && Number(m[2]) !== 0)) return undefined;
  const n = Number(m[1]);
  return n > 0 && n <= MAX_QR_AMOUNT ? n : undefined;
}

function buildPayment(id: string, hint: Hint, name: string | undefined, account: string | undefined, amount: number | undefined): QrPayment | null {
  const digits = id.replace(/\s/g, '');
  const phone = normalizeKenyanPhone(digits);
  const label = name?.trim().slice(0, 80) || undefined;
  let payment: QrPayment | null = null;

  if (phone && (hint === null || hint === 'SEND_MONEY' || hint === 'POCHI')) {
    payment = { type: hint ?? 'SEND_MONEY', counterparty: { phone, ...(label ? { name: label } : {}) } };
  } else if (/^\d{5,7}$/.test(digits) && (hint === 'PAYBILL' || (hint === null && account))) {
    payment = {
      type: 'PAYBILL',
      counterparty: { paybillNumber: digits, ...(label ? { businessName: label } : {}), ...(account ? { accountReference: account.slice(0, 40) } : {}) },
    };
  } else if (/^\d{5,8}$/.test(digits) && (hint === null || hint === 'BUY_GOODS')) {
    payment = { type: 'BUY_GOODS', counterparty: { tillNumber: digits, ...(label ? { name: label } : {}) } };
  }
  if (!payment) return null;
  payment.source = 'MPESA';
  if (amount !== undefined) payment.amount = amount;
  return payment;
}

function parseEmvQr(text: string): QrPayment | null {
  if (!text.startsWith('000201')) return null;
  const root = parseTlv(text);
  if (!root || root.get('00') !== '01') return null;
  const currency = root.get('53');
  if (currency && currency !== '404') return null; // not Kenya shillings
  const country = root.get('58');
  if (country && country !== 'KE') return null;

  // Merchant account templates (26–51). Prefer the one that names Safaricom / M-PESA.
  const templates: Array<{ guid: string; values: string[]; raw: string }> = [];
  for (let t = 26; t <= 51; t++) {
    const raw = root.get(String(t));
    if (!raw) continue;
    const sub = parseTlv(raw);
    if (sub) templates.push({ guid: sub.get('00') ?? '', values: [...sub.entries()].filter(([k]) => k !== '00').map(([, v]) => v), raw });
    else templates.push({ guid: '', values: [raw], raw });
  }
  const isMpesa = (g: string) => (/safaricom|m-?pesa/i.test(g) ? 1 : 0);
  templates.sort((a, b) => isMpesa(b.guid) - isMpesa(a.guid));

  const extraRaw = root.get('62');
  const extra = extraRaw ? parseTlv(extraRaw) : null;
  const account = extra?.get('01') ?? extra?.get('05') ?? undefined; // bill number / reference label
  const name = root.get('59');
  const amount = wholeAmount(root.get('54'));

  for (const tpl of templates) {
    const hint = hintFrom(tpl.raw);
    for (const value of tpl.values) {
      if (!/^\+?[\d\s]{5,13}$/.test(value)) continue;
      const payment = buildPayment(value.replace(/^\+/, ''), hint, name, account, amount);
      if (payment) return payment;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// M-PESA: Daraja-style key/value ("TrxCode=BG&CPI=373132&Amount=100", or the same as JSON)
// ---------------------------------------------------------------------------------------------

const TRX_CODES: Record<string, QrPaymentType> = { BG: 'BUY_GOODS', PB: 'PAYBILL', SM: 'SEND_MONEY', SB: 'POCHI' };

function parseKeyValueQr(text: string): QrPayment | null {
  const fields: Record<string, string> = {};
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' || typeof v === 'number') fields[k.toLowerCase()] = String(v);
    } catch {
      return null;
    }
  } else if (/trxcode=/i.test(text)) {
    for (const pair of text.replace(/^[^?]*\?/, '').split('&')) {
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      try {
        fields[pair.slice(0, i).toLowerCase()] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      } catch {
        return null;
      }
    }
  } else {
    return null;
  }
  const type = TRX_CODES[(fields.trxcode ?? '').toUpperCase()];
  if (!type || !fields.cpi) return null;
  return buildPayment(fields.cpi, type, fields.merchantname, fields.refno, wholeAmount(fields.amount));
}
