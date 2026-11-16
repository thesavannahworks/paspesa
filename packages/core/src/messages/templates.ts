/**
 * Message templates (White Paper §19). Templates are data, separate from processing logic.
 *
 * Status meanings:
 *   REFERENCE_DERIVED — wording copied character for character from product-owner-supplied
 *                       messages (reference-screenshots/08-messages), including their irregular
 *                       spacing ("Ksh7.00.  Amount", "New  balance", "PM  New") and trailing links.
 *   PROVISIONAL       — no example supplied yet; must not be treated as final.
 *
 * Placeholders:
 *   {ref} {amount} {fee} {balance} {date} {time} {limit}
 *   {NAME}   counterparty name in capitals, single-spaced (merchants: "BEREA GEN SHOP")
 *   {PERSON} person's name in capitals as M-PESA prints registered names: a two-part name has an
 *            empty middle name, so it shows a double space ("GETRUDE  OHANGA")
 *   {name} {phone} {maskedPhone} {till} {paybill} {business} {account}
 *
 * Links in the bodies are display text only: tapping one in Paspesa opens the Paspesa home screen.
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

const LIMIT = 'Amount you can transact within the day is {limit}.';

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'SEND_MONEY_CONFIRMATION',
    version: 2,
    transactionType: 'SEND_MONEY',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: `{ref} Confirmed. {amount} sent to {PERSON} {phone} on {date} at {time}. New M-PESA balance is {balance}. Transaction cost, {fee}.  ${LIMIT} See all your balances now https://saf.cx/iqIzU`,
  },
  {
    id: 'POCHI_CONFIRMATION',
    version: 2,
    transactionType: 'POCHI',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: `{ref} Confirmed. {amount} sent to {PERSON} on {date} at {time}. New M-PESA balance is {balance}. Transaction cost, {fee}. ${LIMIT} See all your balances now https://saf.cx/kWQpy`,
  },
  {
    id: 'BUY_GOODS_CONFIRMATION',
    version: 2,
    transactionType: 'BUY_GOODS',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: `{ref} Confirmed. {amount} paid to {NAME}. on {date} at {time}.New M-PESA balance is {balance}. Transaction cost, {fee}. ${LIMIT} See all your balances now https://saf.cx/kWQpy`,
  },
  {
    id: 'PAYBILL_CONFIRMATION',
    version: 2,
    transactionType: 'PAYBILL',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: `{ref} Confirmed. {amount} sent to {business} for account {account} on {date} at {time} New M-PESA balance is {balance}. Transaction cost, {fee}.${LIMIT} See all your balances now https://saf.cx/kWQpy`,
  },
  {
    id: 'AIRTIME_OWN_CONFIRMATION',
    version: 2,
    transactionType: 'AIRTIME',
    variant: 'OWN',
    status: 'REFERENCE_DERIVED',
    body: `{ref} confirmed.You bought {amount} of airtime on {date} at {time}.New M-PESA balance is {balance}. Transaction cost, {fee}. ${LIMIT} See all your balances now https://saf.cx/3wAmy`,
  },
  {
    id: 'AIRTIME_OTHER_CONFIRMATION',
    version: 2,
    transactionType: 'AIRTIME',
    variant: 'OTHER',
    status: 'REFERENCE_DERIVED',
    body: `{ref} confirmed.You bought {amount} of airtime for {phone} on {date} at {time}.New  balance is {balance}. Transaction cost, {fee}. ${LIMIT}You can now access M-PESA via *334#`,
  },
  {
    id: 'RECHARGE_RECEIVED',
    version: 2,
    transactionType: 'RECHARGE',
    variant: null,
    status: 'REFERENCE_DERIVED',
    body: '{ref} Confirmed.You have received {amount} from {PERSON} {maskedPhone} on {date} at {time}  New M-PESA balance is {balance}. Invest & earn daily interest with ZIIDI on https://saf.cx/cF6ir',
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

/** Messages that are not tied to a committed transaction (reference 08-messages). */
export interface NoticeTemplate {
  id: 'WRONG_PIN' | 'WRONG_PIN_REPEATED';
  version: number;
  status: 'REFERENCE_DERIVED';
  body: string;
}

export const NOTICE_TEMPLATES: Record<NoticeTemplate['id'], NoticeTemplate> = {
  // First wrong PIN for a payment.
  WRONG_PIN: {
    id: 'WRONG_PIN',
    version: 1,
    status: 'REFERENCE_DERIVED',
    body: 'You have entered the wrong PIN. Please try again.',
  },
  // A further wrong PIN for the same payment.
  WRONG_PIN_REPEATED: {
    id: 'WRONG_PIN_REPEATED',
    version: 1,
    status: 'REFERENCE_DERIVED',
    body: 'Failed, you have entered the wrong PIN. If forgotten please dial *334#, select My Account, select M-PESA PIN Manager then M-PESA Forgot PIN and follow the prompts.',
  },
};

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
