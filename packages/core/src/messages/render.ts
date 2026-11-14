/**
 * Renders a message strictly from a committed transaction record (White Paper §19.3):
 * every value comes from the saved record, never from form state.
 */
import { formatKshCompact } from '../money';
import { maskPhone, toLocalPhone } from '../phone';
import { formatShortDate, formatTime12, toLocalParts } from '../time';
import type { TransactionRecord } from '../types';
import type { MessageTemplate } from './templates';

export function messageVariables(tx: TransactionRecord, utcOffsetMinutes: number): Record<string, string> {
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
    phone: c.phone ? (tx.type === 'AIRTIME' ? c.phone : toLocalPhone(c.phone)) : '',
    maskedPhone: c.phone ? maskPhone(c.phone) : '',
    till: c.tillNumber ?? c.agentNumber ?? '',
    paybill: c.paybillNumber ?? '',
    business: c.businessName ?? '',
    account: c.accountReference ?? '',
  };
}

export function renderTemplate(template: MessageTemplate, vars: Record<string, string>): string {
  return template.body
    .replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = vars[key];
      if (value === undefined) throw new Error(`Template ${template.id} uses unknown placeholder {${key}}`);
      return value;
    })
    .replace(/ {2,}/g, ' ')
    .trim();
}
