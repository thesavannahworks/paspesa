/**
 * Core Paspesa domain types.
 *
 * All monetary values are WHOLE KENYA SHILLINGS stored as integers
 * (product-owner decision, 2026-11-14). There are no cents anywhere in the ledger.
 */

/** Every simulated operation type the engine can process. */
export type TransactionType =
  | 'OPENING_BALANCE'
  | 'RECHARGE'
  | 'SEND_MONEY'
  | 'POCHI'
  | 'BUY_GOODS'
  | 'PAYBILL'
  | 'WITHDRAW'
  | 'AIRTIME';

/** Transaction types a user can initiate after setup (opening balance is set once, at setup). */
export type SimulationType = Exclude<TransactionType, 'OPENING_BALANCE'>;

export type Direction = 'CREDIT' | 'DEBIT';

/** Business outcome (White Paper §11.4). Only committed outcomes are persisted. */
export type BusinessStatus = 'SUCCESSFUL' | 'FAILED' | 'REVERSED';

/** Synchronization state, deliberately separate from the business status (White Paper §11.4). */
export type SyncStatus = 'LOCAL_ONLY' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'NEEDS_REVIEW';

/**
 * How the user paid Paspesa for this simulation.
 * UNMETERED: simulations are free until the monetization phase (product-owner decision).
 * TOKENS / DIRECT exist so the monetization phase slots in without changing records.
 */
/**
 * TOKENS: Paspesa tokens — from the tokens set aside on this device (works offline), optionally topped up
 * from the central balance while online (`centralTokens`). WALLET: entirely from the central token balance
 * (online, nothing set aside); central parts are deducted when the simulation uploads.
 */
export type PaymentMethod = 'UNMETERED' | 'TOKENS' | 'DIRECT' | 'WALLET';

/** Where the operation originated. */
export type OperationSource = 'ACCOUNT_SETUP' | 'GENERAL_OPERATIONS' | 'TRANSACTION';

/** Airtime purchase target. */
export type AirtimeTarget = 'OWN' | 'OTHER';

/**
 * Where a token-paid simulation's tokens come from: `device` from this phone's set-aside tokens, `central`
 * from the central balance. Zero for UNMETERED and DIRECT.
 */
export function tokenSplit(t: { paymentMethod: PaymentMethod; centralTokens?: number; pricing: { tokenCost: number } | null }): { device: number; central: number } {
  const cost = t.pricing?.tokenCost ?? 0;
  if (t.paymentMethod === 'WALLET') return { device: 0, central: cost };
  if (t.paymentMethod !== 'TOKENS') return { device: 0, central: 0 };
  const central = Math.min(cost, Math.max(0, Math.floor(t.centralTokens ?? 0)));
  return { device: cost - central, central };
}

export interface Account {
  id: string;
  installationId: string;
  accountName: string;
  /** Normalized 2547XXXXXXXX / 2541XXXXXXXX form. */
  phoneNumber: string;
  openingBalance: number;
  /** Fast-access cache. Must always equal the sum of balance movements (see ledger.reconcileAccount). */
  currentBalanceCache: number;
  /** Simulated airtime balance: sum of own-number airtime purchases, capped by config.maxAirtimeBalance. */
  airtimeBalance: number;
  /**
   * Cumulative airtime removed by user resets (interim mechanism while nothing consumes airtime).
   * Invariant: airtimeBalance = sum(own-number airtime purchases) − airtimeResetTotal.
   */
  airtimeResetTotal: number;
  /** User-configured default sender for General Operations recharge; null = use config default (Paspesa). */
  rechargeSenderDefaults: { name: string; phone: string } | null;
  /**
   * Tokens reserved for THIS device for offline use (White Paper §29), as last confirmed by the server and
   * reduced by local spending since. Absent/null = no allocation. Never uploaded: the server keeps its own.
   */
  tokenAllocation?: LocalTokenAllocation | null;
  /** Simulated Paspesa PIN (never the real M-PESA PIN). Null when no PIN has been set. */
  pin: { salt: string; hash: string } | null;
  currency: 'KES';
  createdAt: string;
  updatedAt: string;
  /** Incremented on every committed balance change; used for optimistic checks during sync. */
  version: number;
}

/** A device token allocation as known on the device (§29, §27.6). */
export interface LocalTokenAllocation {
  allocationId: string;
  /** Tokens left to spend offline on this device. */
  remaining: number;
  /** After this, paid offline simulations stop until the device renews online (§29.4). */
  authorizationExpiresAt: string;
  /** The pricing configuration authorized with the allocation; offline prices use it (§27.6). */
  pricing: import('./pricing').PricingConfiguration;
}

/** The other party of a transaction. Which fields apply depends on the transaction type. */
export interface Counterparty {
  name?: string;
  /** Normalized 254XXXXXXXXX form. */
  phone?: string;
  tillNumber?: string;
  paybillNumber?: string;
  businessName?: string;
  accountReference?: string;
  accountName?: string;
  agentNumber?: string;
  storeNumber?: string;
}

export interface TransactionRecord {
  id: string;
  accountId: string;
  /** Client-generated idempotency key; unique per account. */
  operationId: string;
  /** User-facing transaction ID shown on messages, receipts and statements (e.g. UKE7Q2M9XA). */
  reference: string;
  /** Per-account, strictly increasing ledger position (equals Account.version after commit). */
  sequence: number;
  type: TransactionType;
  /** Optional sub-type, e.g. AIRTIME OWN/OTHER. */
  variant: string | null;
  direction: Direction;
  status: BusinessStatus;
  amount: number;
  /** Withdrawal charge the sender added to `amount` (Send Money "add withdrawal charges"). */
  withdrawalCharge?: number;
  fee: number;
  /** amount + fee for debits; 0 for credits. */
  totalDebit: number;
  balanceBefore: number;
  balanceAfter: number;
  /** Airtime balance after an own-number airtime purchase; null for every other transaction. */
  airtimeBalanceAfter: number | null;
  counterparty: Counterparty;
  source: OperationSource;
  feeScheduleId: string;
  feeScheduleVersion: number;
  configVersion: number;
  paymentMethod: PaymentMethod;
  /** DIRECT: the verified Paspesa payment that paid for this simulation (§32). */
  directPaymentId?: string;
  /**
   * TOKENS only: how many of the token cost come from the central balance (chosen online when the phone's
   * set-aside tokens do not cover it, or by the user's preference). The rest comes from this phone.
   */
  centralTokens?: number;
  /** Pricing snapshot for token-funded or directly-paid simulations (§27.5). Null while UNMETERED. */
  pricing: PricingSnapshot | null;
  /** Stable hash of the request, used to detect an operation ID reused for a different request. */
  requestFingerprint: string;
  createdAt: string;
  completedAt: string;
  syncStatus: SyncStatus;
  payloadVersion: number;
}

/** Placeholder for the monetization phase (White Paper §27.5). */
export interface PricingSnapshot {
  formula: 'FULL_AMOUNT' | 'EXCESS_AMOUNT' | 'TIERED';
  freeThreshold: number;
  amountPerToken: number | null;
  tierConfiguration: unknown;
  resolvedRule: string;
  accountOverride: string | null;
  configVersion: number;
  tokenCost: number;
  appliedConfigAt: string;
}

export interface BalanceMovement {
  id: string;
  accountId: string;
  transactionId: string;
  movementType: 'OPENING' | 'CREDIT' | 'DEBIT' | 'REVERSAL';
  /** Always positive; see direction. Includes the fee for debits. */
  amount: number;
  direction: Direction;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: string;
  sourceReference: string;
}

/**
 * TRANSACTION_CONFIRMATION: generated from a committed transaction (transactionId set).
 * SYSTEM_NOTICE: an event without a transaction, e.g. a wrong PIN (transactionId null).
 */
export type MessageCategory = 'TRANSACTION_CONFIRMATION' | 'SYSTEM_NOTICE';

export interface MessageRecord {
  id: string;
  transactionId: string | null;
  /** The payment attempt a notice belongs to (wrong-PIN notices). */
  operationId?: string;
  accountId: string;
  category: MessageCategory;
  templateId: string;
  templateVersion: number;
  body: string;
  createdAt: string;
  readAt: string | null;
  syncStatus: SyncStatus;
  /** Starred from the message menu. */
  starred?: boolean;
  /**
   * Set when the user deletes the message from the Messages screen. Deleting a message only hides
   * the message; the transaction and the M-PESA statement are never affected.
   */
  deletedAt?: string | null;
}

/** DISMISSED: a reviewer kept it out of the server's ledger for good (the device is then out of step). */
export type OutboxStatus = 'PENDING' | 'SYNCING' | 'DONE' | 'FAILED' | 'NEEDS_REVIEW' | 'DISMISSED';

export interface OutboxEntry {
  id: string;
  installationId: string;
  operationId: string;
  entityType: 'ACCOUNT' | 'TRANSACTION' | 'FAVOURITE';
  entityId: string;
  /** DELETE_ACCOUNT: legacy only (an early build queued it); never sent. Deletion is an online request. */
  operationType: 'CREATE_ACCOUNT' | 'UPDATE_ACCOUNT_SETTINGS' | 'CREATE_SIMULATION' | 'UPSERT_FAVOURITE' | 'DELETE_FAVOURITE' | 'DELETE_ACCOUNT';
  payloadVersion: number;
  createdAt: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  status: OutboxStatus;
  lastError: string | null;
  /**
   * What changed, captured when the change happened (settings and favourites). Transactions need none:
   * their records never change, so the sync payload is read from the record itself.
   */
  payload?: OutboxPayload;
}

/** Explicit changes, not resulting state: the server applies and validates them itself (§39). */
export type OutboxPayload =
  | { kind: 'PIN_CHANGED' }
  | { kind: 'DETAILS'; accountName: string; phoneNumber: string }
  | { kind: 'RECHARGE_SENDER'; defaults: { name: string; phone: string } | null }
  | { kind: 'AIRTIME_RESET'; amount: number }
  | { favourite: Favourite }
  | { favouriteId: string };

/** Field-level validation errors keyed by field name. */
export type FieldErrors = Record<string, string>;

/** Manually saved favourite recipient/merchant/biller. */
export interface Favourite {
  id: string;
  accountId: string;
  type: SimulationType;
  /** Stable identity of the counterparty for this type (see catalogue.counterpartyKey). */
  key: string;
  label: string;
  counterparty: Counterparty;
  createdAt: string;
}

export type SimulationErrorCode =
  | 'VALIDATION'
  | 'WRONG_PIN'
  | 'PIN_NOT_SET'
  | 'AIRTIME_BALANCE_LIMIT'
  | 'UNSUPPORTED_AMOUNT'
  | 'INSUFFICIENT_BALANCE'
  | 'PAYMENT_REQUIRED'
  | 'INSUFFICIENT_TOKENS'
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_REQUIRED'
  /** The back office switched this transaction type off. */
  | 'TYPE_DISABLED'
  | 'NO_ACCOUNT'
  | 'ACCOUNT_EXISTS'
  | 'OPERATION_CONFLICT'
  | 'STORAGE_FAILURE';

export interface SimulationError {
  code: SimulationErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
}
