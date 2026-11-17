import type { ChangeSet, MemoryState } from '@paspesa/core';

/** Device storage for the ledger tables (SQLite on the phone, IndexedDB in the browser). */
export interface LedgerPersistence {
  /** Whole ledger, or null when nothing has been saved in the tables yet. */
  load(): Promise<MemoryState | null>;
  /** Writes one atomic unit's rows in a single database transaction. */
  apply(changes: ChangeSet): Promise<void>;
  /** Replaces everything in one transaction (sign-out wipe, or an account restored from the server). */
  replace(state: MemoryState): Promise<void>;
}
