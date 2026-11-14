/**
 * Message templates (White Paper §19). Templates are data, separate from processing logic.
 *
 * Status meanings:
 *   REFERENCE_DERIVED — structure taken from a product-owner-supplied example message.
 *                       Still awaiting final Paspesa wording approval (trailing links,
 *                       daily-limit sentence and branding were intentionally omitted).
 *   PROVISIONAL       — no example supplied yet; must not be treated as final.
 *
 * Placeholders: {ref} {amount} {fee} {balance} {date} {time} {NAME} {name}
 *               {phone} {maskedPhone} {till} {paybill} {business} {account}
 */
import type { TransactionType } from '../types';

export interface MessageTemplate {
  id: string;
  version: number;
  transactionType: TransactionType;
  variant: string | null;
  status: 'APPROVED' | 'REFERENCE_DERIVED' | 'PROVISIONAL';
  body: string;
}

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'SEND_MONEY_CONFIRMATION',
    version: 1,
    transactionType: 'SEND_MONEY',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: '{ref} Confirmed. {amount} sent to {NAME} {phone} on {date} at {time}. New M-PESA balance is {balance}. Transaction cost, {fee}.',
  },
  {
    id: 'POCHI_CONFIRMATION',
    version: 1,
    transactionType: 'POCHI',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: '{ref} Confirmed. {amount} sent to {NAME} on {date} at {time}. New M-PESA balance is {balance}. Transaction cost, {fee}.',
  },
  {
    id: 'BUY_GOODS_CONFIRMATION',
    version: 1,
    transactionType: 'BUY_GOODS',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: '{ref} Confirmed. {amount} paid to {NAME}. on {date} at {time}.New M-PESA balance is {balance}. Transaction cost, {fee}.',
  },
  {
    id: 'PAYBILL_CONFIRMATION',
    version: 1,
    transactionType: 'PAYBILL',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: '{ref} Confirmed. {amount} sent to {business} for account {account} on {date} at {time} New M-PESA balance is {balance}. Transaction cost, {fee}.',
  },
  {
    id: 'AIRTIME_OWN_CONFIRMATION',
    version: 1,
    transactionType: 'AIRTIME',
    variant: 'OWN',
    status: 'REFERENCE_DERIVED',
    body: '{ref} confirmed.You bought {amount} of airtime on {date} at {time}.New M-PESA balance is {balance}. Transaction cost, {fee}.',
  },
  {
    id: 'AIRTIME_OTHER_CONFIRMATION',
    version: 1,
    transactionType: 'AIRTIME',
    variant: 'OTHER',
    status: 'REFERENCE_DERIVED',
    body: '{ref} confirmed.You bought {amount} of airtime for {phone} on {date} at {time}.New balance is {balance}. Transaction cost, {fee}.',
  },
  {
    // Derived from the supplied "You have received … from …" incoming-money message.
    id: 'RECHARGE_RECEIVED',
    version: 1,
    transactionType: 'RECHARGE',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: '{ref} Confirmed.You have received {amount} from {NAME} {maskedPhone} on {date} at {time} New M-PESA balance is {balance}.',
  },
  {
    // PROVISIONAL: awaiting the product owner's withdrawal message example.
    id: 'WITHDRAW_CONFIRMATION',
    version: 1,
    transactionType: 'WITHDRAW',
    variant: null,
    status: 'PROVISIONAL',
    body: '{ref} Confirmed. {amount} withdrawn from agent {till} on {date} at {time}. New M-PESA balance is {balance}. Transaction cost, {fee}.',
  },
];

/** Returns the latest template for a type/variant, or null if the type produces no message. */
export function findTemplate(type: TransactionType, variant: string | null): MessageTemplate | null {
  const candidates = MESSAGE_TEMPLATES.filter(
    (t) => t.transactionType === type && (t.variant === variant || t.variant === null),
  ).sort((a, b) => {
    // Exact variant match first, then highest version.
    const av = a.variant === variant ? 1 : 0;
    const bv = b.variant === variant ? 1 : 0;
    return bv - av || b.version - a.version;
  });
  return candidates[0] ?? null;
}
