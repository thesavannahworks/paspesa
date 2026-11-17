/**
 * Synchronization processing (White Paper §24–25, §39.1).
 *
 * Every uploaded operation is handled in its own database transaction, serialized per installation:
 *   1. De-duplicate by operation ID. Same content → the stored result again (DUPLICATE, safe retry).
 *      Same ID with different content → OPERATION_CONFLICT, kept for review.
 *   2. Validate shape, ownership and versions.
 *   3. Transactions are recomputed with the shared engine rules against the SERVER's account state;
 *      the client's resulting balance is never trusted.
 *   4. Apply, or keep the operation in `sync_review` (never silently dropped, §24.4).
 */
import {
  DEFAULT_CONFIG,
  PAYLOAD_VERSION,
  REFERENCE_PATTERN,
  checkSyncedTransaction,
  normalizeKenyanPhone,
  operationFingerprint,
  type Account,
  type SimulatorConfig,
  type SyncOperation,
  type SyncOperationResult,
  type SyncResultCode,
  type SyncPushResponse,
  type SyncServerState,
  type SyncTransaction,
  type SimulationType,
} from '@paspesa/core';
import { priceSimulation } from '@paspesa/core';
import { AllocationService } from './allocation.service.js';
import type { Database, Queryable } from './database.js';
import { MonetizationService } from './monetization.service.js';

type Outcome = { status: 'SYNCED' | 'NEEDS_REVIEW'; code: SyncResultCode; message?: string };
const applied: Outcome = { status: 'SYNCED', code: 'APPLIED' };
const review = (code: SyncResultCode, message: string): Outcome => ({ status: 'NEEDS_REVIEW', code, message });

interface AccountRow {
  id: string;
  installation_id: string;
  account_name: string;
  phone_number: string;
  opening_balance: number;
  balance: number;
  airtime_balance: number;
  airtime_reset_total: number;
  recharge_sender: { name: string; phone: string } | null;
  version: number;
  currency: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    installationId: r.installation_id,
    accountName: r.account_name,
    phoneNumber: r.phone_number,
    openingBalance: Number(r.opening_balance),
    currentBalanceCache: Number(r.balance),
    airtimeBalance: Number(r.airtime_balance),
    airtimeResetTotal: Number(r.airtime_reset_total),
    rechargeSenderDefaults: r.recharge_sender,
    pin: null, // the simulated PIN never leaves the device
    currency: 'KES',
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    version: Number(r.version),
  };
}

// ---------------------------------------------------------------------------------------------
// Shape checks for untrusted input
// ---------------------------------------------------------------------------------------------

const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const isIso = (v: unknown) => isStr(v, 40) && !Number.isNaN(Date.parse(v));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const TYPES = ['OPENING_BALANCE', 'RECHARGE', 'SEND_MONEY', 'POCHI', 'BUY_GOODS', 'PAYBILL', 'WITHDRAW', 'AIRTIME'];

function transactionShapeError(t: unknown): string | null {
  if (!isObj(t)) return 'transaction missing';
  const bad = (f: string) => `transaction.${f} is invalid`;
  if (!isStr(t.id, 100)) return bad('id');
  if (!isStr(t.accountId, 100)) return bad('accountId');
  if (!isStr(t.operationId, 100)) return bad('operationId');
  if (!isStr(t.reference, 20) || !REFERENCE_PATTERN.test(t.reference)) return bad('reference');
  if (!isInt(t.sequence, 1)) return bad('sequence');
  if (!TYPES.includes(t.type as string)) return bad('type');
  if (t.variant !== null && !isStr(t.variant, 40)) return bad('variant');
  if (t.direction !== 'DEBIT' && t.direction !== 'CREDIT') return bad('direction');
  if (t.status !== 'SUCCESSFUL') return bad('status');
  for (const f of ['amount', 'fee', 'totalDebit', 'balanceBefore', 'balanceAfter', 'feeScheduleVersion', 'configVersion', 'payloadVersion'] as const) {
    if (!isInt(t[f])) return bad(f);
  }
  if (t.airtimeBalanceAfter !== null && !isInt(t.airtimeBalanceAfter)) return bad('airtimeBalanceAfter');
  if (t.withdrawalCharge !== undefined && !isInt(t.withdrawalCharge, 1)) return bad('withdrawalCharge');
  if (!isObj(t.counterparty)) return bad('counterparty');
  if (!isIso(t.createdAt) || !isIso(t.completedAt)) return bad('completedAt');
  return null;
}

// ---------------------------------------------------------------------------------------------

export class SyncService {
  constructor(
    private readonly db: Database,
    private readonly config: SimulatorConfig = DEFAULT_CONFIG,
    private readonly money: MonetizationService = new MonetizationService(db),
    private readonly allocations: AllocationService = new AllocationService(db, money),
  ) {}

  async push(installationId: string, operations: SyncOperation[]): Promise<SyncPushResponse> {
    const results: SyncOperationResult[] = [];
    for (const op of operations) {
      const outcome = await this.db.transaction((q) => this.process(q, installationId, op));
      results.push({ operationId: op.operationId, entityType: op.entityType, ...outcome });
    }
    // A successful synchronization refreshes the device's offline authorization (§29.4).
    const allocation = await this.allocations.renew(installationId);
    return { results, server: await this.serverState(this.db, installationId), allocation };
  }

  /** Server balance and position for this installation (reconciliation, §25.4). */
  state(installationId: string): Promise<SyncServerState | null> {
    return this.serverState(this.db, installationId);
  }

  async serverState(q: Queryable, installationId: string): Promise<SyncServerState | null> {
    const [a] = await q.query<AccountRow>('SELECT * FROM accounts WHERE installation_id = $1', [installationId]);
    return a ? { balance: Number(a.balance), version: Number(a.version), airtimeBalance: Number(a.airtime_balance) } : null;
  }

  private async process(q: Queryable, installationId: string, op: SyncOperation): Promise<Outcome> {
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [installationId]);
    const fingerprint = operationFingerprint(op);
    const [previous] = await q.query<{ fingerprint: string; status: Outcome['status']; code: SyncResultCode; message: string | null }>(
      'SELECT fingerprint, status, code, message FROM sync_operations WHERE installation_id = $1 AND operation_id = $2 AND entity_type = $3',
      [installationId, op.operationId, op.entityType],
    );
    if (previous) {
      if (previous.fingerprint === fingerprint) {
        return previous.status === 'SYNCED' ? { status: 'SYNCED', code: 'DUPLICATE' } : { status: previous.status, code: previous.code, ...(previous.message ? { message: previous.message } : {}) };
      }
      const conflict = review('OPERATION_CONFLICT', 'This operation ID was already used for different content');
      await this.keepForReview(q, installationId, op, conflict);
      return conflict;
    }

    let outcome: Outcome;
    if (op.payloadVersion !== PAYLOAD_VERSION) outcome = review('UNSUPPORTED_VERSION', `Payload version ${op.payloadVersion} is not supported`);
    else outcome = await this.apply(q, installationId, op);

    if (outcome.status === 'NEEDS_REVIEW') await this.keepForReview(q, installationId, op, outcome);
    await q.query(
      `INSERT INTO sync_operations (installation_id, operation_id, entity_type, operation_type, fingerprint, status, code, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [installationId, op.operationId, op.entityType, op.operationType, fingerprint, outcome.status, outcome.code, outcome.message ?? null],
    );
    return outcome;
  }

  private async keepForReview(q: Queryable, installationId: string, op: SyncOperation, outcome: Outcome) {
    await q.query(
      `INSERT INTO sync_review (installation_id, operation_id, entity_type, operation_type, code, message, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [installationId, op.operationId, op.entityType, op.operationType, outcome.code, outcome.message ?? null, JSON.stringify(op.payload ?? null)],
    );
  }

  private async account(q: Queryable, installationId: string): Promise<Account | null> {
    const [row] = await q.query<AccountRow>('SELECT * FROM accounts WHERE installation_id = $1 FOR UPDATE', [installationId]);
    return row ? toAccount(row) : null;
  }

  private async apply(q: Queryable, installationId: string, op: SyncOperation): Promise<Outcome> {
    if (!isObj(op.payload)) return review('VALIDATION', 'payload missing');
    switch (op.operationType) {
      case 'CREATE_ACCOUNT':
        return this.createAccount(q, installationId, op);
      case 'CREATE_SIMULATION':
        return this.createSimulation(q, installationId, op);
      case 'UPDATE_ACCOUNT_SETTINGS':
        return this.updateSettings(q, installationId, op);
      case 'UPSERT_FAVOURITE':
      case 'DELETE_FAVOURITE':
        return this.favourite(q, installationId, op);
      default:
        return review('VALIDATION', 'Unknown operation');
    }
  }

  private async createAccount(q: Queryable, installationId: string, op: Extract<SyncOperation, { operationType: 'CREATE_ACCOUNT' }>): Promise<Outcome> {
    const { account: a, opening: t } = op.payload;
    if (!isObj(a) || !isStr(a.id, 100) || a.installationId !== installationId) return review('VALIDATION', 'account does not belong to this installation');
    if (!isStr(a.accountName, 60) || !normalizeKenyanPhone(String(a.phoneNumber ?? ''))) return review('VALIDATION', 'account name or phone is invalid');
    if (!isInt(a.openingBalance) || a.openingBalance > this.config.maxOpeningBalance) return review('VALIDATION', 'opening balance is out of range');
    const shape = transactionShapeError(t);
    if (shape) return review('VALIDATION', shape);
    if (t.type !== 'OPENING_BALANCE' || t.operationId !== op.operationId || t.accountId !== a.id || t.sequence !== 1
      || t.amount !== a.openingBalance || t.balanceBefore !== 0 || t.balanceAfter !== a.openingBalance || t.direction !== 'CREDIT') {
      return review('BALANCE_MISMATCH', 'opening balance transaction does not match the account');
    }
    const existing = await this.account(q, installationId);
    if (existing) return existing.id === a.id ? applied : review('VALIDATION', 'this installation already has another account');

    await q.query(
      `INSERT INTO accounts (id, installation_id, account_name, phone_number, opening_balance, balance, airtime_balance, airtime_reset_total, recharge_sender, version, currency, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5, 0, 0, NULL, 1, 'KES', $6, $6)`,
      [a.id, installationId, a.accountName, normalizeKenyanPhone(a.phoneNumber), a.openingBalance, a.createdAt],
    );
    await this.insertTransaction(q, a.id, t);
    return applied;
  }

  private async createSimulation(q: Queryable, installationId: string, op: Extract<SyncOperation, { operationType: 'CREATE_SIMULATION' }>): Promise<Outcome> {
    const { transaction: t, message: m } = op.payload;
    const shape = transactionShapeError(t);
    if (shape) return review('VALIDATION', shape);
    if (t.operationId !== op.operationId) return review('VALIDATION', 'operation ID does not match the transaction');
    const account = await this.account(q, installationId);
    if (!account) return review('NO_ACCOUNT', 'the account has not been synchronized yet');
    if (t.accountId !== account.id) return review('VALIDATION', 'transaction belongs to another account');

    const check = checkSyncedTransaction(account, this.config, t);
    if (!check.ok) return review(check.code, check.message);
    // Checked here rather than left to the UNIQUE constraint, so one bad record cannot block every retry.
    const [clash] = await q.query('SELECT 1 FROM transactions WHERE account_id = $1 AND (reference = $2 OR id = $3)', [account.id, t.reference, t.id]);
    if (clash) return review('VALIDATION', 'transaction ID or reference already used');
    const paid = await this.verifyPayment(q, installationId, account.id, t);
    if (paid) return paid;

    await q.query(
      `UPDATE accounts SET balance = $2, airtime_balance = $3, version = $4, updated_at = $5 WHERE id = $1`,
      [account.id, t.balanceAfter, t.airtimeBalanceAfter ?? account.airtimeBalance, t.sequence, t.completedAt],
    );
    await this.insertTransaction(q, account.id, t);
    if (m && isObj(m) && m.transactionId === t.id && isStr(m.id, 100) && typeof m.body === 'string' && m.body.length <= 2000) {
      await q.query(
        `INSERT INTO messages (id, account_id, transaction_id, category, template_id, template_version, body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [m.id, account.id, t.id, String(m.category), String(m.templateId), Number(m.templateVersion) || 1, m.body, m.createdAt],
      );
    }
    return applied;
  }

  /**
   * How the simulation was paid (§26): TOKENS → spent from this device's allocation; DIRECT → a verified
   * payment for this simulation; UNMETERED → only while payments are off or for free simulations.
   */
  private async verifyPayment(q: Queryable, installationId: string, accountId: string, t: SyncTransaction): Promise<Outcome | null> {
    if (t.paymentMethod === 'TOKENS') {
      const spend = await this.allocations.spendSynced(q, {
        accountId, deviceId: installationId, simulationId: t.operationId, type: t.type as SimulationType, amount: t.amount, completedAt: t.completedAt, claimed: t.pricing,
      });
      return spend.ok ? null : review(spend.code, spend.message);
    }
    if (t.paymentMethod === 'DIRECT') {
      const [p] = await q.query<{ id: string; simulation_status: string }>(
        "SELECT id, simulation_status FROM payments WHERE id = $1 AND owner_id = $2 AND related_simulation_id = $3 AND status = 'SUCCESSFUL' FOR UPDATE",
        [t.directPaymentId ?? '', accountId, t.operationId],
      );
      if (!p || (p.simulation_status !== 'AUTHORIZED' && p.simulation_status !== 'SUCCESSFUL')) return review('PAYMENT_NOT_VERIFIED', 'No verified payment for this simulation');
      await q.query("UPDATE payments SET simulation_status = 'SUCCESSFUL' WHERE id = $1", [p.id]);
      return null;
    }
    if ((await this.money.settings(q)).paymentRequired) {
      const cost = priceSimulation(await this.money.pricing(q), { accountId, type: t.type as SimulationType, amount: t.amount, at: t.completedAt }).tokenCost;
      if (cost > 0) return review('PAYMENT_REQUIRED', `This simulation costs ${cost} tokens`);
    }
    return null;
  }

  private async insertTransaction(q: Queryable, accountId: string, t: SyncTransaction) {
    await q.query(
      `INSERT INTO transactions (id, account_id, operation_id, reference, sequence, type, direction, status, amount, fee, balance_after, completed_at, record)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [t.id, accountId, t.operationId, t.reference, t.sequence, t.type, t.direction, t.status, t.amount, t.fee, t.balanceAfter, t.completedAt, JSON.stringify(t)],
    );
    await q.query(
      `INSERT INTO balance_movements (id, account_id, transaction_id, direction, amount, balance_before, balance_after, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`mv-${t.id}`, accountId, t.id, t.direction, t.direction === 'DEBIT' ? t.totalDebit : t.amount, t.balanceBefore, t.balanceAfter, t.completedAt],
    );
  }

  private async updateSettings(q: Queryable, installationId: string, op: Extract<SyncOperation, { operationType: 'UPDATE_ACCOUNT_SETTINGS' }>): Promise<Outcome> {
    const account = await this.account(q, installationId);
    if (!account) return review('NO_ACCOUNT', 'the account has not been synchronized yet');
    const change = op.payload;
    const audit = (action: string, before: unknown, after: unknown) =>
      q.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before_value, after_value) VALUES ($1, $2, $3, $4, $5, $6)', [
        `installation:${installationId}`, action, 'ACCOUNT', account.id, JSON.stringify(before), JSON.stringify(after),
      ]);

    switch (change.kind) {
      case 'DETAILS': {
        const phone = normalizeKenyanPhone(String(change.phoneNumber ?? ''));
        const name = typeof change.accountName === 'string' ? change.accountName.replace(/\s+/g, ' ').trim() : '';
        if (!name || name.length > 60 || !phone) return review('VALIDATION', 'account name or phone is invalid');
        await q.query('UPDATE accounts SET account_name = $2, phone_number = $3, updated_at = now() WHERE id = $1', [account.id, name, phone]);
        await audit('UPDATE_ACCOUNT_DETAILS', { accountName: account.accountName, phoneNumber: account.phoneNumber }, { accountName: name, phoneNumber: phone });
        return applied;
      }
      case 'RECHARGE_SENDER': {
        const d = change.defaults;
        if (d !== null && (!isObj(d) || !isStr(d.name, 60) || !normalizeKenyanPhone(String(d.phone ?? '')))) return review('VALIDATION', 'recharge sender is invalid');
        await q.query('UPDATE accounts SET recharge_sender = $2, updated_at = now() WHERE id = $1', [account.id, d === null ? null : JSON.stringify(d)]);
        await audit('UPDATE_RECHARGE_SENDER', account.rechargeSenderDefaults, d);
        return applied;
      }
      case 'AIRTIME_RESET': {
        // The reset must clear exactly the airtime the server has: otherwise the two ledgers disagree.
        if (!isInt(change.amount, 1) || change.amount !== account.airtimeBalance) {
          return review('BALANCE_MISMATCH', `Airtime balance on the server is ${account.airtimeBalance}`);
        }
        await q.query('UPDATE accounts SET airtime_balance = 0, airtime_reset_total = airtime_reset_total + $2, updated_at = now() WHERE id = $1', [account.id, change.amount]);
        await audit('RESET_AIRTIME_BALANCE', { airtimeBalance: account.airtimeBalance }, { airtimeBalance: 0 });
        return applied;
      }
      case 'PIN_CHANGED':
        // The PIN itself stays on the device (§44); only the fact is recorded.
        await audit('PIN_CHANGED', null, null);
        return applied;
      default:
        return review('VALIDATION', 'Unknown settings change');
    }
  }

  private async favourite(q: Queryable, installationId: string, op: Extract<SyncOperation, { entityType: 'FAVOURITE' }>): Promise<Outcome> {
    const account = await this.account(q, installationId);
    if (!account) return review('NO_ACCOUNT', 'the account has not been synchronized yet');
    if (op.operationType === 'DELETE_FAVOURITE') {
      if (!isStr(op.payload.favouriteId, 100)) return review('VALIDATION', 'favourite ID missing');
      await q.query('DELETE FROM favourites WHERE id = $1 AND account_id = $2', [op.payload.favouriteId, account.id]);
      return applied;
    }
    const f = op.payload.favourite;
    if (!isObj(f) || !isStr(f.id, 100) || f.accountId !== account.id || !TYPES.includes(f.type as string) || !isStr(f.key, 200)) {
      return review('VALIDATION', 'favourite is invalid');
    }
    await q.query('DELETE FROM favourites WHERE account_id = $1 AND (id = $2 OR (type = $3 AND key = $4))', [account.id, f.id, f.type, f.key]);
    await q.query('INSERT INTO favourites (id, account_id, type, key, record) VALUES ($1, $2, $3, $4, $5)', [f.id, account.id, f.type, f.key, JSON.stringify(f)]);
    return applied;
  }

  /** Transactions after a sequence number (retrieve changes, §24 — used for reconciliation and later devices). */
  async pull(installationId: string, afterSequence: number) {
    const [a] = await this.db.query<AccountRow>('SELECT * FROM accounts WHERE installation_id = $1', [installationId]);
    if (!a) return { account: null, transactions: [] as SyncTransaction[] };
    const rows = await this.db.query<{ record: SyncTransaction }>(
      'SELECT record FROM transactions WHERE account_id = $1 AND sequence > $2 ORDER BY sequence LIMIT 500',
      [a.id, afterSequence],
    );
    const account = toAccount(a);
    return {
      account: { id: account.id, accountName: account.accountName, phoneNumber: account.phoneNumber, balance: account.currentBalanceCache, airtimeBalance: account.airtimeBalance, version: account.version },
      transactions: rows.map((r) => r.record),
    };
  }
}
