/**
 * Renders a message strictly from a committed transaction record (White Paper §19.3):
 * every value comes from the saved record, never from form state.
 */
import { formatAmount, formatKshCompact } from '../money';
import { maskPhone, toLocalPhone } from '../phone';
import { formatShortDate, formatTime12, toLocalParts } from '../time';
import type { TransactionRecord } from '../types';

/** Values that come from the ledger around the transaction rather than the record itself. */
export interface MessageContext {
  /** Daily allowance left after this transaction (whole shillings), for "Amount you can transact within the day". */
  dailyRemaining?: number;
}

/**
 * M-PESA prints registered names as first, middle and last name. A two-part name has an empty
 * middle name, so its parts are separated by two spaces ("GETRUDE  OHANGA", reference 08-messages).
 */
export function registeredName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length === 2 ? parts.join('  ') : parts.join(' ');
}

export function messageVariables(tx: TransactionRecord, utcOffsetMinutes: number, context: MessageContext = {}): Record<string, string> {
  const p = toLocalParts(tx.completedAt, utcOffsetMinutes);
  const c = tx.counterparty;
  const displayName = c.name ?? c.businessName ?? '';
  return {
    ref: tx.reference,
    amount: formatKshCompact(tx.amount),
    fee: formatKshCompact(tx.fee),
    balance: formatKshCompact(tx.balanceAfter),
    date: formatShortDate(p),
    time: formatTime12(p),
    name: displayName,
    NAME: displayName.toUpperCase(),
    PERSON: registeredName(displayName).toUpperCase(),
    limit: formatAmount(context.dailyRemaining ?? 0),
    phone: c.phone ? (tx.type === 'AIRTIME' ? c.phone : toLocalPhone(c.phone)) : '',
    maskedPhone: c.phone ? maskPhone(c.phone) : '',
    till: c.tillNumber ?? c.agentNumber ?? '',
    paybill: c.paybillNumber ?? '',
    business: c.businessName ?? '',
    account: c.accountReference ?? '',
  };
}

/** Spacing is kept exactly as in the template: the reference messages have deliberate double spaces. */
export function renderTemplate(template: { id: string; body: string }, vars: Record<string, string>): string {
  return template.body
    .replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = vars[key];
      if (value === undefined) throw new Error(`Template ${template.id} uses unknown placeholder {${key}}`);
      return value;
    })
    .trim();
}
