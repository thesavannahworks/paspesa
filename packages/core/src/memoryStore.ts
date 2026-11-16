/**
 * In-memory LocalStore with real all-or-nothing semantics:
 * each runAtomic works on a deep copy and swaps it in only on success.
 * Used by tests and as the reference behaviour for the SQLite/IndexedDB adapters.
 */
import { isEmptyChangeSet, type ChangeSet } from './changes';
import type { LocalStore, StoreWriter } from './store';
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

export interface MemoryState {
  account: Account | null;
  transactions: TransactionRecord[];
  movements: BalanceMovement[];
  messages: MessageRecord[];
  outbox: OutboxEntry[];
  favourites: Favourite[];
}

const emptyState = (): MemoryState => ({ account: null, transactions: [], movements: [], messages: [], outbox: [], favourites: [] });

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function byNewest<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

class MemoryAccess implements StoreWriter {
  constructor(protected state: MemoryState) {}

  async getAccount() { return this.state.account ? clone(this.state.account) : null; }
  async getTransaction(id: string) { return clone(this.state.transactions.find((t) => t.id === id) ?? null); }
  async getTransactionByOperationId(operationId: string) {
    return clone(this.state.transactions.find((t) => t.operationId === operationId) ?? null);
  }
  async getTransactionByReference(reference: string) {
    return clone(this.state.transactions.find((t) => t.reference === reference) ?? null);
  }
  async listTransactions() { return clone(byNewest(this.state.transactions)); }
  async listMovements() { return clone(this.state.movements); }
  async getMessageByTransactionId(transactionId: string) {
    return clone(this.state.messages.find((m) => m.transactionId === transactionId) ?? null);
  }
  async listMessages() { return clone(byNewest(this.state.messages)); }
  async listOutbox(status?: OutboxStatus) {
    return clone(this.state.outbox.filter((e) => !status || e.status === status));
  }
  async listFavourites() { return clone(this.state.favourites); }
  async upsertFavourite(favourite: Favourite) {
    const i = this.state.favourites.findIndex((f) => f.type === favourite.type && f.key === favourite.key);
    if (i >= 0) this.state.favourites[i] = clone(favourite);
    else this.state.favourites.push(clone(favourite));
  }
  async deleteFavourite(id: string) {
    this.state.favourites = this.state.favourites.filter((f) => f.id !== id);
  }

  async putAccount(account: Account) { this.state.account = clone(account); }
  async insertTransaction(tx: TransactionRecord) {
    if (this.state.transactions.some((t) => t.id === tx.id || t.operationId === tx.operationId || t.reference === tx.reference)) {
      throw new Error('UNIQUE constraint failed: transaction id/operationId/reference');
    }
    this.state.transactions.push(clone(tx));
  }
  async insertMovement(movement: BalanceMovement) {
    if (this.state.movements.some((m) => m.transactionId === movement.transactionId && m.movementType === movement.movementType)) {
      throw new Error('UNIQUE constraint failed: movement per transaction');
    }
    this.state.movements.push(clone(movement));
  }
  async insertMessage(message: MessageRecord) {
    if (message.transactionId !== null && this.state.messages.some((m) => m.transactionId === message.transactionId)) {
      throw new Error('UNIQUE constraint failed: message per transaction');
    }
    this.state.messages.push(clone(message));
  }
  async enqueueOutbox(entry: OutboxEntry) {
    if (this.state.outbox.some((e) => e.operationId === entry.operationId && e.entityType === entry.entityType)) {
      throw new Error('UNIQUE constraint failed: outbox operation');
    }
    this.state.outbox.push(clone(entry));
  }
  async updateOutbox(entry: OutboxEntry) {
    const i = this.state.outbox.findIndex((e) => e.id === entry.id);
    if (i < 0) throw new Error(`Outbox entry ${entry.id} not found`);
    this.state.outbox[i] = clone(entry);
  }
  async setTransactionSyncStatus(transactionId: string, status: SyncStatus) {
    const tx = this.state.transactions.find((t) => t.id === transactionId);
    if (!tx) throw new Error(`Transaction ${transactionId} not found`);
    tx.syncStatus = status;
    const msg = this.state.messages.find((m) => m.transactionId === transactionId);
    if (msg) msg.syncStatus = status;
  }
  async markMessageRead(messageId: string, readAt: string) {
    const msg = this.state.messages.find((m) => m.id === messageId);
    if (msg && !msg.readAt) msg.readAt = readAt;
  }
  async updateMessage(message: MessageRecord) {
    const i = this.state.messages.findIndex((m) => m.id === message.id);
    if (i < 0) throw new Error(`Message ${message.id} not found`);
    this.state.messages[i] = clone(message);
  }
}

/** Records which rows a unit touched, so only those rows are written to the tables. */
class TrackingAccess extends MemoryAccess {
  readonly touched = { account: false, favourites: false, transactions: new Set<string>(), movements: new Set<string>(), messages: new Set<string>(), outbox: new Set<string>() };

  override async putAccount(account: Account) { await super.putAccount(account); this.touched.account = true; }
  override async insertTransaction(tx: TransactionRecord) { await super.insertTransaction(tx); this.touched.transactions.add(tx.id); }
  override async insertMovement(m: BalanceMovement) { await super.insertMovement(m); this.touched.movements.add(m.id); }
  override async insertMessage(m: MessageRecord) { await super.insertMessage(m); this.touched.messages.add(m.id); }
  override async enqueueOutbox(e: OutboxEntry) { await super.enqueueOutbox(e); this.touched.outbox.add(e.id); }
  override async updateOutbox(e: OutboxEntry) { await super.updateOutbox(e); this.touched.outbox.add(e.id); }
  override async setTransactionSyncStatus(transactionId: string, status: SyncStatus) {
    await super.setTransactionSyncStatus(transactionId, status);
    this.touched.transactions.add(transactionId);
    for (const m of this.state.messages) if (m.transactionId === transactionId) this.touched.messages.add(m.id);
  }
  override async markMessageRead(id: string, readAt: string) { await super.markMessageRead(id, readAt); this.touched.messages.add(id); }
  override async updateMessage(m: MessageRecord) { await super.updateMessage(m); this.touched.messages.add(m.id); }
  override async upsertFavourite(f: Favourite) { await super.upsertFavourite(f); this.touched.favourites = true; }
  override async deleteFavourite(id: string) { await super.deleteFavourite(id); this.touched.favourites = true; }

  changes(): ChangeSet {
    const pick = <T extends { id: string }>(rows: T[], ids: Set<string>) => (ids.size ? clone(rows.filter((r) => ids.has(r.id))) : []);
    const t = this.touched;
    return {
      ...(t.account && this.state.account ? { account: clone(this.state.account) } : {}),
      transactions: pick(this.state.transactions, t.transactions),
      movements: pick(this.state.movements, t.movements),
      messages: pick(this.state.messages, t.messages),
      outbox: pick(this.state.outbox, t.outbox),
      ...(t.favourites ? { favourites: clone(this.state.favourites) } : {}),
    };
  }
}

export interface MemoryStoreOptions {
  /**
   * Durably saves the complete new state. Called once per atomic unit, BEFORE the new state
   * becomes visible. If it throws, the unit is rolled back and the error propagates
   * (the engine then reports STORAGE_FAILURE and nothing is committed).
   */
  persist?: (state: MemoryState) => Promise<void>;
  /**
   * Durably saves only the rows the unit changed, in ONE database transaction (SQLite / IndexedDB
   * tables). Same contract as `persist`: called before the new state becomes visible; if it throws,
   * nothing is committed. Not called for units that changed nothing.
   */
  persistChanges?: (changes: ChangeSet) => Promise<void>;
}

/** Fills in collections added after a state was first saved (forward-compatible loading). */
export function normalizeState(raw: Partial<MemoryState> | null | undefined): MemoryState {
  return { ...emptyState(), ...(raw ?? {}) };
}

export class MemoryStore extends MemoryAccess implements LocalStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly persist: MemoryStoreOptions['persist'];
  private readonly persistChanges: MemoryStoreOptions['persistChanges'];

  constructor(initial?: Partial<MemoryState>, options: MemoryStoreOptions = {}) {
    super(normalizeState(initial ? clone(initial) : undefined));
    this.persist = options.persist;
    this.persistChanges = options.persistChanges;
  }

  /** Test hook: inject a failure into the next atomic unit after N writes. */
  failAfterWrites: number | null = null;

  runAtomic<T>(work: (tx: StoreWriter) => Promise<T>): Promise<T> {
    const run = async () => {
      const working = clone(this.state);
      const tracking = new TrackingAccess(working);
      const access = this.failAfterWrites === null ? tracking : this.faultyAccess(tracking, this.failAfterWrites);
      const result = await work(access);
      // durable first…
      if (this.persist) await this.persist(clone(working));
      if (this.persistChanges) {
        const changes = tracking.changes();
        if (!isEmptyChangeSet(changes)) await this.persistChanges(changes);
      }
      this.state = working; // …then visible
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  snapshot(): MemoryState {
    return clone(this.state);
  }

  private faultyAccess(access: TrackingAccess, limit: number): StoreWriter {
    let writes = 0;
    const writeMethods = new Set([
      'putAccount', 'insertTransaction', 'insertMovement', 'insertMessage',
      'enqueueOutbox', 'updateOutbox', 'setTransactionSyncStatus', 'markMessageRead', 'updateMessage',
      'upsertFavourite', 'deleteFavourite',
    ]);
    return new Proxy(access, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function' && writeMethods.has(String(prop))) {
          return async (...args: unknown[]) => {
            if (writes >= limit) throw new Error('Simulated storage failure');
            writes++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}
