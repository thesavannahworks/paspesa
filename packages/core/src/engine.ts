/**
 * Central transaction engine (White Paper §11).
 *
 * Every simulator operation — opening balance, recharge, send money, pochi, buy goods,
 * paybill, withdraw, airtime — is committed here and nowhere else. One atomic unit writes:
 * transaction record + balance movement + message + account balance + sync outbox entry.
 *
 * Idempotency (§25): the client generates `operationId` once, when the user first confirms,
 * persists it with the pending journey, and reuses it on every retry. A repeated operationId
 * returns the original committed result and never applies anything twice.
 *
 * Two different "fees" exist and must never be confused:
 *   - Transaction cost  = simulated M-PESA tariff fee (§13–17). Part of the simulated ledger.
 *   - Paspesa service fee = token cost / direct payment for running the simulation (§26–27).
 *     Not part of the simulated balance. UNMETERED until the monetization phase.
 */
import { getDefinition, type CounterpartyInput, type TransactionDefinition } from './catalogue';
import { getFeeSchedule, type SimulatorConfig } from './config/defaults';
import { resolveFee } from './fees';
import { findTemplate } from './messages/templates';
import { messageVariables, renderTemplate } from './messages/render';
import { formatKsh, isWholeShillings } from './money';
import { normalizeKenyanPhone } from './phone';
import type { Clock, IdGenerator, PinHasher, RandomSource } from './ports';
import { generateReference } from './reference';
import type { LocalStore, StoreWriter } from './store';
import { toLocalParts } from './time';
import type {
  Account,
  BalanceMovement,
  Counterparty,
  FieldErrors,
  MessageRecord,
  PaymentMethod,
  SimulationError,
  SimulationType,
  TransactionRecord,
} from './types';
import { PAYLOAD_VERSION, PIN_PATTERN, fail, outboxEntry, stableStringify, type Failure } from './util';

export { PAYLOAD_VERSION, stableStringify };

export interface EngineDeps {
  store: LocalStore;
  config: SimulatorConfig;
  clock: Clock;
  ids: IdGenerator;
  random: RandomSource;
  pinHasher: PinHasher;
  installationId: string;
}

export interface SimulationRequest {
  operationId: string;
  type: SimulationType;
  amount: number;
  counterparty: CounterpartyInput;
  /** e.g. AIRTIME: 'OWN' | 'OTHER' */
  variant?: string;
  /** Paspesa service payment method. Defaults to UNMETERED until the monetization phase. */
  paymentMethod?: PaymentMethod;
  /** Simulated Paspesa PIN entered on the PIN screen. Not part of the request fingerprint. */
  pin?: string;
}

export interface Quote {
  type: SimulationType;
  definition: TransactionDefinition;
  amount: number;
  /** Simulated M-PESA transaction cost. */
  fee: number;
  totalDebit: number;
  balanceBefore: number;
  balanceAfter: number;
  airtimeBalanceAfter: number | null;
  counterparty: Counterparty;
  variant: string | null;
  feeScheduleId: string;
  feeScheduleVersion: number;
  paymentMethod: PaymentMethod;
}

export type QuoteResult = { ok: true; quote: Quote } | Failure;

export type SimulationResult =
  | {
      ok: true;
      /** true when this call returned an already-committed result for the same operationId. */
      duplicate: boolean;
      transaction: TransactionRecord;
      message: MessageRecord | null;
      account: Account;
    }
  | { ok: false; error: SimulationError };

/**
 * Confirmation-screen "Transaction cost" display, as in the reference journeys:
 * "N/A" when the simulated M-PESA fee is zero, otherwise the amount.
 * (PIN and success screens always show the amount, e.g. "Fee:Ksh. 0.00".)
 */
export function formatConfirmTransactionCost(fee: number): string {
  return fee === 0 ? 'N/A' : formatKsh(fee);
}

// ---------------------------------------------------------------------------
// Quote: the single calculation used by the confirmation screen AND the commit.
// ---------------------------------------------------------------------------

export function quoteSimulation(
  account: Account,
  config: SimulatorConfig,
  request: Omit<SimulationRequest, 'operationId' | 'pin'>,
): QuoteResult {
  const definition = getDefinition(request.type);
  const paymentMethod = request.paymentMethod ?? 'UNMETERED';
  if (paymentMethod !== 'UNMETERED') {
    return fail('VALIDATION', 'This payment method is not available yet', { paymentMethod: 'Not available yet' });
  }

  const errors: FieldErrors = {};
  const { counterparty, variant, errors: fieldErrors } = definition.normalize(request.counterparty ?? {}, {
    account,
    config,
    variant: request.variant,
  });
  Object.assign(errors, fieldErrors);

  if (!isWholeShillings(request.amount) || request.amount <= 0) {
    errors.amount = 'Enter an amount in whole shillings';
  }
  if (Object.keys(errors).length > 0) return fail('VALIDATION', 'Please correct the highlighted fields', errors);

  const schedule = getFeeSchedule(config, request.type);
  const fee = resolveFee(schedule, request.amount);
  if (!fee.ok) {
    const message = `Amount must be between ${formatKsh(fee.min)} and ${formatKsh(fee.max)}`;
    return fail('UNSUPPORTED_AMOUNT', message, { amount: message });
  }

  let airtimeBalanceAfter: number | null = null;
  if (request.type === 'AIRTIME' && variant === 'OWN') {
    airtimeBalanceAfter = account.airtimeBalance + request.amount;
    if (airtimeBalanceAfter > config.maxAirtimeBalance) {
      const room = Math.max(0, config.maxAirtimeBalance - account.airtimeBalance);
      const message = `Airtime balance cannot exceed ${formatKsh(config.maxAirtimeBalance)}. You can top up at most ${formatKsh(room)}.`;
      return fail('AIRTIME_BALANCE_LIMIT', message, { amount: message });
    }
  }

  const balanceBefore = account.currentBalanceCache;
  const isDebit = definition.direction === 'DEBIT';
  const totalDebit = isDebit ? request.amount + fee.fee : 0;
  if (isDebit && totalDebit > balanceBefore) {
    return fail(
      'INSUFFICIENT_BALANCE',
      `Insufficient balance. You need ${formatKsh(totalDebit)} (including ${formatKsh(fee.fee)} transaction cost) but have ${formatKsh(balanceBefore)}.`,
      { amount: 'Insufficient balance' },
    );
  }

  return {
    ok: true,
    quote: {
      type: request.type,
      definition,
      amount: request.amount,
      fee: fee.fee,
      totalDebit,
      balanceBefore,
      balanceAfter: isDebit ? balanceBefore - totalDebit : balanceBefore + request.amount,
      airtimeBalanceAfter,
      counterparty,
      variant,
      feeScheduleId: fee.scheduleId,
      feeScheduleVersion: fee.scheduleVersion,
      paymentMethod,
    },
  };
}

// ---------------------------------------------------------------------------
// PIN (simulated Paspesa PIN — never the real M-PESA PIN)
// ---------------------------------------------------------------------------

export async function checkPin(deps: Pick<EngineDeps, 'config' | 'pinHasher'>, account: Account, pin: string | undefined): Promise<Failure | null> {
  if (!pin || !PIN_PATTERN.test(pin)) return fail('WRONG_PIN', 'Enter your 4-digit Paspesa PIN', { pin: 'Enter 4 digits' });
  if (deps.config.pinMode === 'ANY_PIN') return null;
  if (!account.pin) return fail('PIN_NOT_SET', 'Set your Paspesa PIN first');
  const hash = await deps.pinHasher.hash(pin, account.pin.salt);
  return hash === account.pin.hash ? null : fail('WRONG_PIN', 'You have entered the wrong PIN. Please try again.', { pin: 'Wrong PIN' });
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export async function processSimulation(deps: EngineDeps, request: SimulationRequest): Promise<SimulationResult> {
  if (!request.operationId) return fail('VALIDATION', 'Missing operation identifier');
  const fingerprint = requestFingerprint(request);

  try {
    return await deps.store.runAtomic(async (tx): Promise<SimulationResult> => {
      const existing = await tx.getTransactionByOperationId(request.operationId);
      if (existing) return replayExisting(tx, existing, fingerprint);

      const account = await tx.getAccount();
      if (!account) return fail('NO_ACCOUNT', 'Set up your simulated account first');

      const pinFailure = await checkPin(deps, account, request.pin);
      if (pinFailure) return pinFailure;

      const quoted = quoteSimulation(account, deps.config, request);
      if (!quoted.ok) return quoted;
      const q = quoted.quote;

      const now = deps.clock.now();
      const sequence = account.version + 1;
      const record: TransactionRecord = {
        id: deps.ids.uuid(),
        accountId: account.id,
        operationId: request.operationId,
        reference: await uniqueReference(tx, deps, now),
        sequence,
        type: q.type,
        variant: q.variant,
        direction: q.definition.direction,
        status: 'SUCCESSFUL',
        amount: q.amount,
        fee: q.fee,
        totalDebit: q.totalDebit,
        balanceBefore: q.balanceBefore,
        balanceAfter: q.balanceAfter,
        airtimeBalanceAfter: q.airtimeBalanceAfter,
        counterparty: q.counterparty,
        source: q.definition.source,
        feeScheduleId: q.feeScheduleId,
        feeScheduleVersion: q.feeScheduleVersion,
        configVersion: deps.config.version,
        paymentMethod: q.paymentMethod,
        pricing: null,
        requestFingerprint: fingerprint,
        createdAt: now,
        completedAt: now,
        syncStatus: 'PENDING',
        payloadVersion: PAYLOAD_VERSION,
      };

      const updatedAccount: Account = {
        ...account,
        currentBalanceCache: q.balanceAfter,
        airtimeBalance: q.airtimeBalanceAfter ?? account.airtimeBalance,
        version: sequence,
        updatedAt: now,
      };

      await tx.insertTransaction(record);
      await tx.insertMovement(movementFor(deps, record, q.definition.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT'));
      const message = buildMessage(deps, record);
      if (message) await tx.insertMessage(message);
      await tx.putAccount(updatedAccount);
      await tx.enqueueOutbox(outboxEntry(deps.ids, deps.installationId, record.operationId, 'TRANSACTION', record.id, 'CREATE_SIMULATION', now));

      return { ok: true, duplicate: false, transaction: record, message, account: updatedAccount };
    });
  } catch (error) {
    // Nothing was committed (runAtomic is all-or-nothing). The same operationId can be retried safely.
    return fail('STORAGE_FAILURE', 'The simulation could not be saved. No changes were made; please try again.', undefined, error);
  }
}

// ---------------------------------------------------------------------------
// Account setup + opening balance (§10.1)
// ---------------------------------------------------------------------------

export interface SetupAccountRequest {
  operationId: string;
  accountName: string;
  phoneNumber: string;
  openingBalance: number;
  /** Required when config.pinMode is USER_PIN; ignored (not stored) under ANY_PIN. */
  pin?: string;
}

export async function setupAccount(deps: EngineDeps, request: SetupAccountRequest): Promise<SimulationResult> {
  const errors: FieldErrors = {};
  const accountName = request.accountName.replace(/\s+/g, ' ').trim();
  if (!accountName) errors.accountName = 'Name is required';
  else if (accountName.length > 60) errors.accountName = 'Name must be at most 60 characters';
  const phone = normalizeKenyanPhone(request.phoneNumber);
  if (!phone) errors.phoneNumber = 'Enter a valid Kenyan mobile number';
  if (!isWholeShillings(request.openingBalance) || request.openingBalance < 0) {
    errors.openingBalance = 'Enter an amount in whole shillings';
  } else if (request.openingBalance > deps.config.maxOpeningBalance) {
    errors.openingBalance = `Opening balance cannot exceed ${formatKsh(deps.config.maxOpeningBalance)}`;
  }
  const needsPin = deps.config.pinMode === 'USER_PIN';
  if (needsPin && !PIN_PATTERN.test(request.pin ?? '')) errors.pin = 'Choose a 4-digit Paspesa PIN';
  const fingerprint = stableStringify({ kind: 'SETUP', accountName, phone, openingBalance: request.openingBalance });

  try {
    return await deps.store.runAtomic(async (tx): Promise<SimulationResult> => {
      const existingOp = await tx.getTransactionByOperationId(request.operationId);
      if (existingOp) return replayExisting(tx, existingOp, fingerprint);
      if (await tx.getAccount()) return fail('ACCOUNT_EXISTS', 'An account is already set up on this device');
      if (Object.keys(errors).length > 0) return fail('VALIDATION', 'Please correct the highlighted fields', errors);

      const now = deps.clock.now();
      let pin: Account['pin'] = null;
      if (needsPin) {
        const salt = deps.ids.uuid();
        pin = { salt, hash: await deps.pinHasher.hash(request.pin!, salt) };
      }
      const account: Account = {
        id: deps.ids.uuid(),
        installationId: deps.installationId,
        accountName,
        phoneNumber: phone!,
        openingBalance: request.openingBalance,
        currentBalanceCache: request.openingBalance,
        airtimeBalance: 0,
        airtimeResetTotal: 0,
        rechargeSenderDefaults: null,
        pin,
        currency: 'KES',
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      const record: TransactionRecord = {
        id: deps.ids.uuid(),
        accountId: account.id,
        operationId: request.operationId,
        reference: await uniqueReference(tx, deps, now),
        sequence: 1,
        type: 'OPENING_BALANCE',
        variant: null,
        direction: 'CREDIT',
        status: 'SUCCESSFUL',
        amount: request.openingBalance,
        fee: 0,
        totalDebit: 0,
        balanceBefore: 0,
        balanceAfter: request.openingBalance,
        airtimeBalanceAfter: null,
        counterparty: {},
        source: 'ACCOUNT_SETUP',
        feeScheduleId: 'NONE',
        feeScheduleVersion: 0,
        configVersion: deps.config.version,
        paymentMethod: 'UNMETERED',
        pricing: null,
        requestFingerprint: fingerprint,
        createdAt: now,
        completedAt: now,
        syncStatus: 'PENDING',
        payloadVersion: PAYLOAD_VERSION,
      };

      await tx.putAccount(account);
      await tx.insertTransaction(record);
      await tx.insertMovement(movementFor(deps, record, 'OPENING'));
      await tx.enqueueOutbox(outboxEntry(deps.ids, deps.installationId, request.operationId, 'ACCOUNT', account.id, 'CREATE_ACCOUNT', now));
      return { ok: true, duplicate: false, transaction: record, message: null, account };
    });
  } catch (error) {
    return fail('STORAGE_FAILURE', 'Account setup could not be saved. No changes were made; please try again.', undefined, error);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function replayExisting(tx: StoreWriter, existing: TransactionRecord, fingerprint: string): Promise<SimulationResult> {
  if (existing.requestFingerprint !== fingerprint) {
    return fail('OPERATION_CONFLICT', 'This operation ID was already used for a different request');
  }
  const [message, account] = await Promise.all([tx.getMessageByTransactionId(existing.id), tx.getAccount()]);
  if (!account) return fail('NO_ACCOUNT', 'Account not found');
  return { ok: true, duplicate: true, transaction: existing, message, account };
}

async function uniqueReference(tx: StoreWriter, deps: EngineDeps, nowIso: string): Promise<string> {
  const parts = toLocalParts(nowIso, deps.config.utcOffsetMinutes);
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateReference(parts, deps.random);
    if (!(await tx.getTransactionByReference(candidate))) return candidate;
  }
  throw new Error('Could not generate a unique transaction reference');
}

function movementFor(deps: EngineDeps, record: TransactionRecord, movementType: BalanceMovement['movementType']): BalanceMovement {
  const isDebit = record.direction === 'DEBIT';
  return {
    id: deps.ids.uuid(),
    accountId: record.accountId,
    transactionId: record.id,
    movementType,
    amount: isDebit ? record.totalDebit : record.amount,
    direction: record.direction,
    balanceBefore: record.balanceBefore,
    balanceAfter: record.balanceAfter,
    createdAt: record.completedAt,
    sourceReference: record.reference,
  };
}

function buildMessage(deps: EngineDeps, record: TransactionRecord): MessageRecord | null {
  const template = findTemplate(record.type, record.variant);
  if (!template) return null;
  return {
    id: deps.ids.uuid(),
    transactionId: record.id,
    accountId: record.accountId,
    category: 'TRANSACTION_CONFIRMATION',
    templateId: template.id,
    templateVersion: template.version,
    body: renderTemplate(template, messageVariables(record, deps.config.utcOffsetMinutes)),
    createdAt: record.completedAt,
    readAt: null,
    syncStatus: record.syncStatus,
  };
}

export function requestFingerprint(request: SimulationRequest): string {
  return stableStringify({
    type: request.type,
    amount: request.amount,
    variant: request.variant ?? null,
    counterparty: request.counterparty ?? {},
    paymentMethod: request.paymentMethod ?? 'UNMETERED',
  });
}
