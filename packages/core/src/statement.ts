/**
 * Statements and history are views over the transaction ledger (White Paper §21–22).
 * Nothing here stores data; the same records always produce the same statement.
 */
import { describeCounterparty, getDefinition } from './catalogue';
import { formatAmount } from './money';
import { formatLongDate, formatTime12, localDateKey, toLocalParts } from './time';
import type { Direction, TransactionRecord, TransactionType } from './types';

export interface StatementRow {
  transactionId: string;
  reference: string;
  type: TransactionType;
  category: string;
  title: string;
  subtitle: string;
  direction: Direction;
  amount: number;
  fee: number;
  /** +amount for credits, -amount for debits (fee shown separately). */
  signedAmount: number;
  balanceAfter: number;
  time: string;
  completedAt: string;
}

export interface StatementGroup {
  dateKey: string;
  heading: string;
  rows: StatementRow[];
}

export interface StatementOptions {
  utcOffsetMinutes: number;
  search?: string;
  /** Inclusive local dates, YYYY-MM-DD. */
  fromDate?: string;
  toDate?: string;
}

export interface Statement {
  groups: StatementGroup[];
  rowCount: number;
  totals: { moneyIn: number; moneyOut: number; fees: number };
  /** Balance immediately before the earliest row in range, and after the latest. */
  openingBalance: number | null;
  closingBalance: number | null;
}

/** Statement-list amount style from the references: "-KSH.3", "+KSH.180", "-KSH.2,000". */
export function formatStatementAmount(signedAmount: number): string {
  return `${signedAmount < 0 ? '-' : '+'}KSH.${formatAmount(Math.abs(signedAmount)).replace(/\.00$/, '')}`;
}

/** Type chip shown on the transaction detail card. */
export function typeLabelFor(type: TransactionType): string {
  return type === 'OPENING_BALANCE' ? 'Opening Balance' : getDefinition(type).displayName;
}

export function categoryFor(type: TransactionType): string {
  return type === 'OPENING_BALANCE' ? 'Opening Balance' : getDefinition(type).statementCategory;
}

export function toStatementRow(tx: TransactionRecord, utcOffsetMinutes: number): StatementRow {
  const { title, subtitle } = describeCounterparty(tx);
  const p = toLocalParts(tx.completedAt, utcOffsetMinutes);
  return {
    transactionId: tx.id,
    reference: tx.reference,
    type: tx.type,
    category: categoryFor(tx.type),
    title,
    subtitle,
    direction: tx.direction,
    amount: tx.amount,
    fee: tx.fee,
    signedAmount: tx.direction === 'CREDIT' ? tx.amount : -tx.amount,
    balanceAfter: tx.balanceAfter,
    time: formatTime12(p).toLowerCase(),
    completedAt: tx.completedAt,
  };
}

function matches(row: StatementRow, tx: TransactionRecord, query: string): boolean {
  const c = tx.counterparty;
  const haystack = [
    row.title, row.subtitle, row.reference, row.category, formatAmount(row.amount), String(row.amount),
    c.name, c.phone, c.tillNumber, c.paybillNumber, c.businessName, c.accountReference, c.accountName, c.agentNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function buildStatement(transactions: TransactionRecord[], options: StatementOptions): Statement {
  const committed = transactions
    .filter((t) => t.status === 'SUCCESSFUL' || t.status === 'REVERSED')
    .sort((a, b) => b.sequence - a.sequence);

  const groups = new Map<string, StatementGroup>();
  const inRange: TransactionRecord[] = [];
  const totals = { moneyIn: 0, moneyOut: 0, fees: 0 };

  for (const tx of committed) {
    const p = toLocalParts(tx.completedAt, options.utcOffsetMinutes);
    const key = localDateKey(p);
    if (options.fromDate && key < options.fromDate) continue;
    if (options.toDate && key > options.toDate) continue;
    const row = toStatementRow(tx, options.utcOffsetMinutes);
    if (options.search && !matches(row, tx, options.search)) continue;

    inRange.push(tx);
    if (tx.direction === 'CREDIT') totals.moneyIn += tx.amount;
    else {
      totals.moneyOut += tx.amount;
      totals.fees += tx.fee;
    }
    let group = groups.get(key);
    if (!group) {
      group = { dateKey: key, heading: formatLongDate(p), rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  const oldest = inRange[inRange.length - 1];
  const newest = inRange[0];
  return {
    groups: [...groups.values()],
    rowCount: inRange.length,
    totals,
    openingBalance: oldest ? oldest.balanceBefore : null,
    closingBalance: newest ? newest.balanceAfter : null,
  };
}
