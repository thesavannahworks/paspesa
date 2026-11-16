/**
 * Persistence port. The engine only talks to this interface.
 * Adapters: MemoryStore (tests), SQLite (Android/iOS), IndexedDB (web), PostgreSQL (backend).
 *
 * runAtomic MUST be all-or-nothing: if the callback throws, none of its writes may persist
 * (White Paper §11.3). Concurrent runAtomic calls MUST be serialized per account.
 */
import type {
  Account,
  BalanceMovement,
  Favourite,
  MessageRecord,
  OutboxEntry,
  OutboxStatus,
  SyncStatus,
  TransactionRecord,
} from './types';

export interface StoreReader {
  getAccount(): Promise<Account | null>;
  getTransaction(id: string): Promise<TransactionRecord | null>;
  getTransactionByOperationId(operationId: string): Promise<TransactionRecord | null>;
  getTransactionByReference(reference: string): Promise<TransactionRecord | null>;
  /** All transactions, newest first. */
  listTransactions(): Promise<TransactionRecord[]>;
  /** All movements, oldest first. */
  listMovements(): Promise<BalanceMovement[]>;
  getMessageByTransactionId(transactionId: string): Promise<MessageRecord | null>;
  /** All messages, newest first. */
  listMessages(): Promise<MessageRecord[]>;
  listOutbox(status?: OutboxStatus): Promise<OutboxEntry[]>;
  listFavourites(): Promise<Favourite[]>;
}

export interface StoreWriter extends StoreReader {
  putAccount(account: Account): Promise<void>;
  insertTransaction(tx: TransactionRecord): Promise<void>;
  insertMovement(movement: BalanceMovement): Promise<void>;
  insertMessage(message: MessageRecord): Promise<void>;
  enqueueOutbox(entry: OutboxEntry): Promise<void>;
  updateOutbox(entry: OutboxEntry): Promise<void>;
  setTransactionSyncStatus(transactionId: string, status: SyncStatus): Promise<void>;
  markMessageRead(messageId: string, readAt: string): Promise<void>;
  /** Replaces an existing message (star / delete flags). */
  updateMessage(message: MessageRecord): Promise<void>;
  /** Insert or replace by (type, key). */
  upsertFavourite(favourite: Favourite): Promise<void>;
  deleteFavourite(id: string): Promise<void>;
}

export interface LocalStore extends StoreReader {
  runAtomic<T>(work: (tx: StoreWriter) => Promise<T>): Promise<T>;
}
