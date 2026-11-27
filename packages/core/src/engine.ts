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
import { DEFAULT_MONETIZATION_SETTINGS, DEFAULT_PRICING, priceSimulation } from './pricing';
import { resolveFee } from './fees';
import { NOTICE_TEMPLATES, findTemplate } from './messages/templates';
import { messageVariables, renderTemplate, type MessageContext } from './messages/render';
import { formatKsh, isWholeShillings } from './money';
import { normalizeKenyanPhone } from './phone';
import type { Clock, IdGenerator, PinHasher, RandomSource } from './ports';
import { OWN_NODE, generateReference } from './reference';
import type { LocalStore, StoreWriter } from './store';
import { localDateKey, toLocalParts } from './time';
import type {
  Account,
  BalanceMovement,
  Counterparty,
  FieldErrors,
  LocalTokenAllocation,
  MessageRecord,
  PaymentMethod,
  PricingSnapshot,
  SimulationError,
  SimulationType,
  TransactionRecord,
  TransactionType,
} from './types';
import { tokenSplit } from './types';
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
  /**
   * How this simulation is paid for (chosen per simulation, §26): UNMETERED (free while payments are off, or
   * for 0-token simulations), TOKENS (from this device's allocation, works offline) or DIRECT (paid online).
   */
  paymentMethod?: PaymentMethod;
  /** DIRECT: the verified Paspesa payment for this simulation (the server checks it on sync, §32). */
  directPaymentId?: string;
  /** TOKENS: tokens taken from the central balance (online top-up); the rest comes from this phone. */
  centralTokens?: number;
  /** Simulated Paspesa PIN entered on the PIN screen. Not part of the request fingerprint. */
  pin?: string;
  /**
   * BIOMETRIC: the user approved with the phone's biometrics instead of the PIN (only offered once
   * they turned biometrics on, which itself requires the PIN). The device OS performs the check.
   * Not part of the request fingerprint. A future backend must treat this as a device assertion.
   */
  authMethod?: 'PIN' | 'BIOMETRIC';
  /**
   * SEND_MONEY only: also send the agent withdrawal charge for `amount`, so the recipient can withdraw
   * the full amount (the M-PESA "add withdrawal charges" option). The charge is added to the sent amount.
   */
  addWithdrawalCharge?: boolean;
}

/** Agent withdrawal charge for an amount, or null when the amount is outside the withdrawal schedule. */
export function withdrawalChargeFor(config: SimulatorConfig, amount: number): number | null {
  if (!isWholeShillings(amount) || amount <= 0) return null;
  const r = resolveFee(getFeeSchedule(config, 'WITHDRAW'), amount);
  return r.ok ? r.fee : null;
}

export interface Quote {
  type: SimulationType;
  definition: TransactionDefinition;
  /** Amount sent/received, including any withdrawal charge the sender chose to add. */
  amount: number;
  /** Withdrawal charge included in `amount` (0 when not added). */
  withdrawalCharge: number;
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
  /** Paspesa token price of this simulation (§27); stored with paid simulations. */
  pricing: PricingSnapshot;
}

export interface QuoteOptions {
  /** When the simulation happens (pricing effective dates). Defaults to now. */
  at?: string;
  /**
   * Server-side checks of an uploaded record skip the device's payment rules: the server verifies the
   * payment separately against its own wallet, allocations and payments (§27.6, §39.1).
   */
  ignorePayment?: boolean;
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
  options: QuoteOptions = {},
): QuoteResult {
  // Back-office switch (Settings → Transaction Type Controls): a type switched off cannot be simulated.
  if (config.monetization.transactionTypeControls?.[request.type] === false) {
    return fail('TYPE_DISABLED', 'This service is not available at the moment.');
  }
  const definition = getDefinition(request.type);
  const paymentMethod = request.paymentMethod ?? 'UNMETERED';

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

  let withdrawalCharge = 0;
  if (request.addWithdrawalCharge) {
    const charge = request.type === 'SEND_MONEY' ? withdrawalChargeFor(config, request.amount) : null;
    if (charge === null) {
      const message = 'Withdrawal charges can only be added to Send Money amounts that can be withdrawn';
      return fail('VALIDATION', message, { amount: message });
    }
    withdrawalCharge = charge;
  }
  const amount = request.amount + withdrawalCharge;

  const schedule = getFeeSchedule(config, request.type);
  const fee = resolveFee(schedule, amount);
  if (!fee.ok) {
    const message = `Amount must be between ${formatKsh(fee.min)} and ${formatKsh(fee.max)}`;
    return fail('UNSUPPORTED_AMOUNT', message, { amount: message });
  }

  let airtimeBalanceAfter: number | null = null;
  if (request.type === 'AIRTIME' && variant === 'OWN') {
    airtimeBalanceAfter = account.airtimeBalance + amount;
    if (airtimeBalanceAfter > config.maxAirtimeBalance) {
      const room = Math.max(0, config.maxAirtimeBalance - account.airtimeBalance);
      const message = `Airtime balance cannot exceed ${formatKsh(config.maxAirtimeBalance)}. You can top up at most ${formatKsh(room)}.`;
      return fail('AIRTIME_BALANCE_LIMIT', message, { amount: message });
    }
  }

  // Paspesa price (§27). Token-funded simulations use the pricing authorized with the allocation (§27.6).
  const at = options.at ?? new Date().toISOString();
  const allocation = account.tokenAllocation ?? null;
  const pricingConfig = paymentMethod === 'TOKENS' && allocation ? allocation.pricing : config.pricing ?? DEFAULT_PRICING;
  let pricing: PricingSnapshot;
  try {
    pricing = priceSimulation(pricingConfig, { accountId: account.id, type: request.type, amount, at });
  } catch (e) {
    // Free play never depends on pricing: without a usable rule, an unpaid simulation is simply free.
    const paymentNeeded = paymentMethod !== 'UNMETERED' || (config.monetization ?? DEFAULT_MONETIZATION_SETTINGS).paymentRequired;
    if (paymentNeeded) return fail('VALIDATION', 'Pricing is not available right now. Please try again later.', undefined, e);
    pricing = { formula: 'FULL_AMOUNT', freeThreshold: 0, amountPerToken: null, tierConfiguration: null, resolvedRule: 'unpriced', accountOverride: null, configVersion: 0, tokenCost: 0, appliedConfigAt: at };
  }
  if (!options.ignorePayment) {
    const payment = checkPayment(config, allocation, paymentMethod, pricing.tokenCost, at, request.directPaymentId, request.centralTokens);
    if (payment) return payment;
  }

  const balanceBefore = account.currentBalanceCache;
  const isDebit = definition.direction === 'DEBIT';
  const totalDebit = isDebit ? amount + fee.fee : 0;
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
      amount,
      withdrawalCharge,
      fee: fee.fee,
      totalDebit,
      balanceBefore,
      balanceAfter: isDebit ? balanceBefore - totalDebit : balanceBefore + amount,
      airtimeBalanceAfter,
      counterparty,
      variant,
      feeScheduleId: fee.scheduleId,
      feeScheduleVersion: fee.scheduleVersion,
      paymentMethod,
      pricing,
    },
  };
}

// ---------------------------------------------------------------------------
// Paspesa payment rules (White Paper §26, §29) — all inert while monetization.paymentRequired is off
// ---------------------------------------------------------------------------

function checkPayment(
  config: SimulatorConfig,
  allocation: LocalTokenAllocation | null,
  method: PaymentMethod,
  tokenCost: number,
  at: string,
  directPaymentId: string | undefined,
  centralTokens?: number,
): Failure | null {
  const settings = config.monetization ?? DEFAULT_MONETIZATION_SETTINGS;
  const authorized = !!allocation && Date.parse(at) <= Date.parse(allocation.authorizationExpiresAt);
  if (method === 'TOKENS') {
    // Only the phone's part is checked here; a central top-up is checked online and deducted on upload.
    const fromPhone = tokenSplit({ paymentMethod: 'TOKENS', centralTokens, pricing: { tokenCost } }).device;
    if (fromPhone === 0) return null;
    if (!allocation) return fail('INSUFFICIENT_TOKENS', 'No tokens are set aside on this phone. Connect to the internet to get some.');
    if (!authorized) return fail('AUTHORIZATION_EXPIRED', 'Your offline tokens need renewing. Connect to the internet to continue.');
    if (allocation.remaining < fromPhone) {
      return fail('INSUFFICIENT_TOKENS', `This simulation needs ${fromPhone} tokens from this phone; ${allocation.remaining} are set aside on it.`);
    }
    return null;
  }
  // Central balance: checked online by the pay sheet, deducted by the server when the record uploads.
  if (method === 'WALLET') return null;
  if (method === 'DIRECT') {
    if (tokenCost === 0) return null;
    return directPaymentId ? null : fail('PAYMENT_REQUIRED', 'Complete the payment for this simulation first.');
  }
  // UNMETERED
  if (!settings.paymentRequired) return null;
  if (tokenCost > 0) return fail('PAYMENT_REQUIRED', `This simulation costs ${tokenCost} tokens. Choose how to pay for it.`);
  // Free simulation: allowed offline unless the back office requires an authorized device (§29.6).
  if (!settings.freeSimulationsOffline && !authorized) {
    return fail('AUTHORIZATION_REQUIRED', 'Connect to the internet to authorize this phone for simulations.');
  }
  return null;
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

      const pinFailure = request.authMethod === 'BIOMETRIC' ? null : await checkPin(deps, account, request.pin);
      if (pinFailure) {
        // A wrong PIN is logged in Messages like M-PESA does (reference 08-messages). The notice is
        // committed even though the payment is not.
        if (pinFailure.error.code === 'WRONG_PIN' && PIN_PATTERN.test(request.pin ?? '')) {
          await tx.insertMessage(await wrongPinNotice(tx, deps, account.id, request.operationId));
        }
        return pinFailure;
      }

      const now = deps.clock.now();
      const quoted = quoteSimulation(account, deps.config, request, { at: now });
      if (!quoted.ok) return quoted;
      const q = quoted.quote;

      const sequence = account.version + 1;
      const split = tokenSplit({ paymentMethod: q.paymentMethod, centralTokens: request.centralTokens, pricing: q.pricing });
      const record: TransactionRecord = {
        id: deps.ids.uuid(),
        accountId: account.id,
        operationId: request.operationId,
        reference: await uniqueReference(tx, deps, now, q.type === 'RECHARGE' ? undefined : OWN_NODE),
        sequence,
        type: q.type,
        variant: q.variant,
        direction: q.definition.direction,
        status: 'SUCCESSFUL',
        amount: q.amount,
        ...(q.withdrawalCharge ? { withdrawalCharge: q.withdrawalCharge } : {}),
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
        ...(q.paymentMethod === 'DIRECT' && request.directPaymentId ? { directPaymentId: request.directPaymentId } : {}),
        ...(q.paymentMethod === 'TOKENS' && split.central > 0 ? { centralTokens: split.central } : {}),
        pricing: q.paymentMethod === 'UNMETERED' ? null : q.pricing,
        requestFingerprint: fingerprint,
        createdAt: now,
        completedAt: now,
        syncStatus: 'PENDING',
        payloadVersion: PAYLOAD_VERSION,
      };

      const allocation = account.tokenAllocation ?? null;
      const spentTokens = split.device;
      const updatedAccount: Account = {
        ...account,
        ...(allocation && spentTokens > 0 ? { tokenAllocation: { ...allocation, remaining: allocation.remaining - spentTokens } } : {}),
        currentBalanceCache: q.balanceAfter,
        airtimeBalance: q.airtimeBalanceAfter ?? account.airtimeBalance,
        version: sequence,
        updatedAt: now,
      };

      await tx.insertTransaction(record);
      await tx.insertMovement(movementFor(deps, record, q.definition.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT'));
      const message = buildMessage(deps, record, { dailyRemaining: await dailyRemaining(tx, deps, record) });
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
        reference: await uniqueReference(tx, deps, now, OWN_NODE),
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

async function uniqueReference(tx: StoreWriter, deps: EngineDeps, nowIso: string, node: string | undefined): Promise<string> {
  const parts = toLocalParts(nowIso, deps.config.utcOffsetMinutes);
  const epochMs = Date.parse(nowIso);
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateReference(parts, deps.random, { epochMs, node });
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

/** Payments that use up the day's allowance (fees excluded, as in the reference messages). */
const DAILY_ALLOWANCE_TYPES = new Set<TransactionType>(['SEND_MONEY', 'POCHI', 'BUY_GOODS', 'PAYBILL', 'AIRTIME', 'WITHDRAW']);

/** Allowance left for the record's local day, including the record itself. Display only; never enforced. */
async function dailyRemaining(tx: StoreWriter, deps: EngineDeps, record: TransactionRecord): Promise<number> {
  const offset = deps.config.utcOffsetMinutes;
  const day = localDateKey(toLocalParts(record.completedAt, offset));
  const used = (await tx.listTransactions())
    .filter((t) => t.status === 'SUCCESSFUL' && DAILY_ALLOWANCE_TYPES.has(t.type) && localDateKey(toLocalParts(t.completedAt, offset)) === day)
    .reduce((sum, t) => sum + t.amount, 0);
  return Math.max(0, deps.config.dailyTransactionLimit - used);
}

/** First wrong PIN for a payment gets the short notice; further attempts get the "Failed, …" one. */
async function wrongPinNotice(tx: StoreWriter, deps: EngineDeps, accountId: string, operationId: string): Promise<MessageRecord> {
  const earlier = (await tx.listMessages()).some((m) => m.category === 'SYSTEM_NOTICE' && m.operationId === operationId);
  const template = NOTICE_TEMPLATES[earlier ? 'WRONG_PIN_REPEATED' : 'WRONG_PIN'];
  return {
    id: deps.ids.uuid(),
    transactionId: null,
    operationId,
    accountId,
    category: 'SYSTEM_NOTICE',
    templateId: template.id,
    templateVersion: template.version,
    body: template.body,
    createdAt: deps.clock.now(),
    readAt: null,
    syncStatus: 'LOCAL_ONLY',
  };
}

function buildMessage(deps: EngineDeps, record: TransactionRecord, context: MessageContext): MessageRecord | null {
  const template = findTemplate(record.type, record.variant);
  if (!template) return null;
  return {
    id: deps.ids.uuid(),
    transactionId: record.id,
    accountId: record.accountId,
    category: 'TRANSACTION_CONFIRMATION',
    templateId: template.id,
    templateVersion: template.version,
    body: renderTemplate(template, messageVariables(record, deps.config.utcOffsetMinutes, context)),
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
    ...(request.directPaymentId ? { directPaymentId: request.directPaymentId } : {}),
    ...(request.paymentMethod === 'TOKENS' && (request.centralTokens ?? 0) > 0 ? { centralTokens: request.centralTokens } : {}),
    ...(request.addWithdrawalCharge ? { addWithdrawalCharge: true } : {}),
  });
}
