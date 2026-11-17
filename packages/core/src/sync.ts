/**
 * Synchronization (White Paper §24–25): the API contract shared by the app and the backend, the client
 * that uploads the outbox, and the server-side check of every uploaded transaction.
 *
 * Flow: local commit → outbox entry (PENDING) → upload (SYNCING) → server validates, de-duplicates by
 * operation ID and stores → result per operation → SYNCED (outbox DONE) or NEEDS_REVIEW.
 * Retries are always safe: the server recognises operation IDs it has already processed (§24.2).
 */
import { quoteSimulation, type EngineDeps, type SimulationRequest } from './engine';
import type { SimulatorConfig } from './config/defaults';
import type { StoreReader } from './store';
import type {
  Account,
  Favourite,
  MessageRecord,
  OutboxEntry,
  OutboxPayload,
  SimulationType,
  TransactionRecord,
} from './types';
import { PAYLOAD_VERSION, stableStringify } from './util';

export const SYNC_API_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------

/** A committed transaction as uploaded (sync status is local bookkeeping and is left out). */
export type SyncTransaction = Omit<TransactionRecord, 'syncStatus'>;

/** The confirmation message as uploaded (read / starred / deleted are local only). */
export type SyncMessage = Pick<MessageRecord, 'id' | 'transactionId' | 'category' | 'templateId' | 'templateVersion' | 'body' | 'createdAt'>;

/** Account identity at creation. Balances are never uploaded: the server derives them (§39.1). */
export type SyncAccount = Pick<Account, 'id' | 'installationId' | 'accountName' | 'phoneNumber' | 'openingBalance' | 'currency' | 'createdAt'>;

interface OperationBase {
  operationId: string;
  payloadVersion: number;
  createdAt: string;
}

export type SyncOperation =
  | (OperationBase & { entityType: 'ACCOUNT'; operationType: 'CREATE_ACCOUNT'; payload: { account: SyncAccount; opening: SyncTransaction } })
  | (OperationBase & { entityType: 'TRANSACTION'; operationType: 'CREATE_SIMULATION'; payload: { transaction: SyncTransaction; message: SyncMessage | null } })
  | (OperationBase & { entityType: 'ACCOUNT'; operationType: 'UPDATE_ACCOUNT_SETTINGS'; payload: Extract<OutboxPayload, { kind: string }> })
  | (OperationBase & { entityType: 'FAVOURITE'; operationType: 'UPSERT_FAVOURITE'; payload: { favourite: Favourite } })
  | (OperationBase & { entityType: 'FAVOURITE'; operationType: 'DELETE_FAVOURITE'; payload: { favouriteId: string } });

export interface SyncPushRequest {
  apiVersion: number;
  installationId: string;
  operations: SyncOperation[];
}

export type SyncResultCode =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'OPERATION_CONFLICT'
  | 'BALANCE_MISMATCH'
  | 'FEE_MISMATCH'
  | 'VALIDATION'
  | 'NO_ACCOUNT'
  | 'UNSUPPORTED_VERSION';

export interface SyncOperationResult {
  operationId: string;
  entityType: SyncOperation['entityType'];
  /** SYNCED: stored (or already stored). NEEDS_REVIEW: kept aside for review; never silently dropped. */
  status: 'SYNCED' | 'NEEDS_REVIEW';
  code: SyncResultCode;
  message?: string;
}

/** The server's view after the push, for reconciliation (§25.4). */
export interface SyncServerState {
  balance: number;
  version: number;
  airtimeBalance: number;
}

export interface SyncPushResponse {
  results: SyncOperationResult[];
  server: SyncServerState | null;
}

export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
}

/**
 * What the server de-duplicates on: the parts of an operation that can never legitimately change.
 * (A CREATE_ACCOUNT retried after the user renamed themselves is still the same operation.)
 */
export function operationFingerprint(op: SyncOperation): string {
  if (op.operationType === 'CREATE_ACCOUNT') {
    const { account, opening } = op.payload;
    return stableStringify({ op: op.operationType, accountId: account.id, openingBalance: account.openingBalance, opening });
  }
  return stableStringify({ op: op.operationType, entityType: op.entityType, payload: op.payload });
}

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

const toSyncTransaction = ({ syncStatus: _ignored, ...rest }: TransactionRecord): SyncTransaction => rest;
const toSyncMessage = (m: MessageRecord): SyncMessage => ({
  id: m.id, transactionId: m.transactionId, category: m.category, templateId: m.templateId,
  templateVersion: m.templateVersion, body: m.body, createdAt: m.createdAt,
});

/** Builds the upload for one outbox entry from the local records. Null = nothing left to send. */
export async function buildSyncOperation(entry: OutboxEntry, store: StoreReader): Promise<SyncOperation | null> {
  const base = { operationId: entry.operationId, payloadVersion: entry.payloadVersion, createdAt: entry.createdAt };
  switch (entry.operationType) {
    case 'CREATE_ACCOUNT': {
      const account = await store.getAccount();
      const opening = (await store.listTransactions()).find((t) => t.type === 'OPENING_BALANCE');
      if (!account || !opening) return null;
      const { id, installationId, accountName, phoneNumber, openingBalance, currency, createdAt } = account;
      return { ...base, entityType: 'ACCOUNT', operationType: 'CREATE_ACCOUNT', payload: { account: { id, installationId, accountName, phoneNumber, openingBalance, currency, createdAt }, opening: toSyncTransaction(opening) } };
    }
    case 'CREATE_SIMULATION': {
      const transaction = await store.getTransaction(entry.entityId);
      if (!transaction) return null;
      const message = await store.getMessageByTransactionId(transaction.id);
      return { ...base, entityType: 'TRANSACTION', operationType: 'CREATE_SIMULATION', payload: { transaction: toSyncTransaction(transaction), message: message ? toSyncMessage(message) : null } };
    }
    case 'UPDATE_ACCOUNT_SETTINGS': {
      if (entry.payload && 'kind' in entry.payload) return { ...base, entityType: 'ACCOUNT', operationType: 'UPDATE_ACCOUNT_SETTINGS', payload: entry.payload };
      // Entries queued before change payloads existed: send the current details (last write wins).
      const account = await store.getAccount();
      if (!account) return null;
      return { ...base, entityType: 'ACCOUNT', operationType: 'UPDATE_ACCOUNT_SETTINGS', payload: { kind: 'DETAILS', accountName: account.accountName, phoneNumber: account.phoneNumber } };
    }
    case 'UPSERT_FAVOURITE': {
      const favourite = entry.payload && 'favourite' in entry.payload ? entry.payload.favourite : (await store.listFavourites()).find((f) => f.id === entry.entityId);
      return favourite ? { ...base, entityType: 'FAVOURITE', operationType: 'UPSERT_FAVOURITE', payload: { favourite } } : null;
    }
    case 'DELETE_FAVOURITE':
      return { ...base, entityType: 'FAVOURITE', operationType: 'DELETE_FAVOURITE', payload: { favouriteId: entry.entityId } };
  }
}

const UPLOADABLE: OutboxEntry['status'][] = ['PENDING', 'FAILED', 'SYNCING'];

/** Upload order: time first; at the same instant the account comes first, transactions by sequence. */
function orderEntries(entries: OutboxEntry[], sequenceOf: Map<string, number>): OutboxEntry[] {
  const rank = (e: OutboxEntry) => (e.operationType === 'CREATE_ACCOUNT' ? 0 : 1);
  return [...entries].sort(
    (a, b) =>
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
      rank(a) - rank(b) ||
      (sequenceOf.get(a.entityId) ?? 0) - (sequenceOf.get(b.entityId) ?? 0),
  );
}

export interface SyncReport {
  uploaded: number;
  synced: number;
  needsReview: number;
  /** Set when the upload could not be completed (offline, server down); entries stay queued. */
  error: string | null;
  server: SyncServerState | null;
}

/** Uploads everything waiting in the outbox, in batches. Safe to call at any time and repeatedly. */
export async function syncOutbox(deps: EngineDeps, transport: SyncTransport, batchSize = 50): Promise<SyncReport> {
  const report: SyncReport = { uploaded: 0, synced: 0, needsReview: 0, error: null, server: null };
  for (let round = 0; round < 100; round++) {
    const picked = await deps.store.runAtomic(async (tx) => {
      const waiting = (await tx.listOutbox()).filter((e) => UPLOADABLE.includes(e.status));
      if (!waiting.length) return null;
      const sequenceOf = new Map((await tx.listTransactions()).map((t) => [t.id, t.sequence] as const));
      const batch = orderEntries(waiting, sequenceOf).slice(0, batchSize);
      const now = deps.clock.now();
      const operations: SyncOperation[] = [];
      const sending: OutboxEntry[] = [];
      for (const entry of batch) {
        const op = await buildSyncOperation(entry, tx);
        if (!op) {
          await tx.updateOutbox({ ...entry, status: 'DONE', lastError: 'Nothing to upload', lastAttemptAt: now });
          continue;
        }
        const marked: OutboxEntry = { ...entry, status: 'SYNCING', attemptCount: entry.attemptCount + 1, lastAttemptAt: now };
        await tx.updateOutbox(marked);
        operations.push(op);
        sending.push(marked);
      }
      return { operations, sending };
    });
    if (!picked) break;
    if (!picked.operations.length) continue;

    let response: SyncPushResponse;
    try {
      response = await transport.push({ apiVersion: SYNC_API_VERSION, installationId: deps.installationId, operations: picked.operations });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await deps.store.runAtomic(async (tx) => {
        for (const entry of picked.sending) await tx.updateOutbox({ ...entry, status: 'FAILED', lastError: message });
      });
      report.error = message;
      return report;
    }

    report.server = response.server;
    report.uploaded += picked.operations.length;
    const resultFor = new Map(response.results.map((r) => [`${r.entityType}:${r.operationId}`, r] as const));
    let unanswered = false;
    await deps.store.runAtomic(async (tx) => {
      for (const entry of picked.sending) {
        const r = resultFor.get(`${entry.entityType}:${entry.operationId}`);
        if (!r) {
          unanswered = true;
          await tx.updateOutbox({ ...entry, status: 'FAILED', lastError: 'No result from server' });
          continue;
        }
        const ok = r.status === 'SYNCED';
        if (ok) report.synced++;
        else report.needsReview++;
        await tx.updateOutbox({ ...entry, status: ok ? 'DONE' : 'NEEDS_REVIEW', lastError: ok ? null : `${r.code}${r.message ? `: ${r.message}` : ''}` });
        if (entry.entityType === 'TRANSACTION' || entry.operationType === 'CREATE_ACCOUNT') {
          const txId = entry.entityType === 'TRANSACTION' ? entry.entityId : (await tx.listTransactions()).find((t) => t.type === 'OPENING_BALANCE')?.id;
          if (txId && (await tx.getTransaction(txId))) await tx.setTransactionSyncStatus(txId, ok ? 'SYNCED' : 'NEEDS_REVIEW');
        }
      }
    });
    if (unanswered) {
      report.error = 'The server did not answer every operation';
      return report;
    }
  }
  return report;
}

/** Counts for a sync indicator. */
export async function outboxSummary(store: StoreReader): Promise<{ waiting: number; needsReview: number; failed: number }> {
  const all = await store.listOutbox();
  return {
    waiting: all.filter((e) => UPLOADABLE.includes(e.status)).length,
    needsReview: all.filter((e) => e.status === 'NEEDS_REVIEW').length,
    failed: all.filter((e) => e.status === 'FAILED').length,
  };
}

// ---------------------------------------------------------------------------------------------
// Server-side check (§39.1): recompute an uploaded transaction with the same engine rules
// ---------------------------------------------------------------------------------------------

export type TransactionCheck = { ok: true } | { ok: false; code: 'BALANCE_MISMATCH' | 'FEE_MISMATCH' | 'VALIDATION' | 'UNSUPPORTED_VERSION'; message: string };

/**
 * Checks an uploaded transaction against the server's own account state: it must follow the account's
 * last committed position and match what the engine computes (fee, amount, balances). The client's
 * resulting balance is never trusted.
 */
export function checkSyncedTransaction(account: Account, config: SimulatorConfig, t: SyncTransaction): TransactionCheck {
  if (t.payloadVersion !== PAYLOAD_VERSION) return { ok: false, code: 'UNSUPPORTED_VERSION', message: `Payload version ${t.payloadVersion} is not supported` };
  if (t.configVersion !== config.version) return { ok: false, code: 'UNSUPPORTED_VERSION', message: `Config version ${t.configVersion} is not known to the server` };
  if (t.type === 'OPENING_BALANCE') return { ok: false, code: 'VALIDATION', message: 'An opening balance can only be created with the account' };
  if (t.sequence !== account.version + 1 || t.balanceBefore !== account.currentBalanceCache) {
    return { ok: false, code: 'BALANCE_MISMATCH', message: `Expected sequence ${account.version + 1} from balance ${account.currentBalanceCache}` };
  }
  const charge = t.withdrawalCharge ?? 0;
  const request: Omit<SimulationRequest, 'operationId'> = {
    type: t.type as SimulationType,
    variant: t.variant ?? undefined,
    amount: t.amount - charge,
    counterparty: t.counterparty,
    paymentMethod: t.paymentMethod,
    ...(charge > 0 ? { addWithdrawalCharge: true } : {}),
  };
  const quoted = quoteSimulation(account, config, request);
  if (!quoted.ok) return { ok: false, code: 'VALIDATION', message: quoted.error.message };
  const q = quoted.quote;
  if (q.fee !== t.fee || q.amount !== t.amount || q.totalDebit !== t.totalDebit) {
    return { ok: false, code: 'FEE_MISMATCH', message: `Expected amount ${q.amount}, fee ${q.fee}` };
  }
  if (q.balanceAfter !== t.balanceAfter || (q.airtimeBalanceAfter ?? null) !== (t.airtimeBalanceAfter ?? null) || q.definition.direction !== t.direction) {
    return { ok: false, code: 'BALANCE_MISMATCH', message: `Expected balance ${q.balanceAfter}` };
  }
  return { ok: true };
}
