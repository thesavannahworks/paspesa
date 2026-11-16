/**
 * Row-level change sets: what one atomic unit changed, so adapters write only those rows
 * (SQLite / IndexedDB tables) instead of re-saving the whole ledger.
 */
import type { MemoryState } from './memoryStore';
import type { Account, BalanceMovement, Favourite, MessageRecord, OutboxEntry, TransactionRecord } from './types';

export interface ChangeSet {
  /** The account after the unit, when it changed. */
  account?: Account;
  /** Inserted or updated rows (final values after the unit). */
  transactions: TransactionRecord[];
  movements: BalanceMovement[];
  messages: MessageRecord[];
  outbox: OutboxEntry[];
  /** Favourites are few and keyed by (type, key): when they change, the whole list is replaced. */
  favourites?: Favourite[];
}

export const emptyChangeSet = (): ChangeSet => ({ transactions: [], movements: [], messages: [], outbox: [] });

export function isEmptyChangeSet(c: ChangeSet): boolean {
  return !c.account && !c.favourites && !c.transactions.length && !c.movements.length && !c.messages.length && !c.outbox.length;
}

/** Every row of a state (used to migrate a whole saved state into tables). */
export function stateToChangeSet(state: MemoryState): ChangeSet {
  return {
    ...(state.account ? { account: state.account } : {}),
    transactions: state.transactions,
    movements: state.movements,
    messages: state.messages,
    outbox: state.outbox,
    favourites: state.favourites,
  };
}

function upsert<T extends { id: string }>(rows: T[], changed: T[]): T[] {
  if (!changed.length) return rows;
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  for (const c of changed) byId.set(c.id, c);
  return [...byId.values()];
}

/** Applies a change set to a state (reference behaviour for adapters and tests). */
export function applyChangeSet(state: MemoryState, c: ChangeSet): MemoryState {
  return {
    account: c.account ?? state.account,
    transactions: upsert(state.transactions, c.transactions),
    movements: upsert(state.movements, c.movements),
    messages: upsert(state.messages, c.messages),
    outbox: upsert(state.outbox, c.outbox),
    favourites: c.favourites ?? state.favourites,
  };
}
