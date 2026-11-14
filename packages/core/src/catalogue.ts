/**
 * Transaction catalogue (White Paper §12). Each type is described once, here.
 * Adding a type means adding a definition — the engine itself does not change (§12.8).
 */
import type { SimulatorConfig } from './config/defaults';
import { maskPhone, normalizeKenyanPhone, toLocalPhone } from './phone';
import type {
  Account,
  AirtimeTarget,
  Counterparty,
  Direction,
  FieldErrors,
  OperationSource,
  SimulationType,
  TransactionRecord,
  TransactionType,
} from './types';

/** Raw, unvalidated counterparty input as typed on a form. */
export interface CounterpartyInput {
  name?: string;
  phone?: string;
  tillNumber?: string;
  paybillNumber?: string;
  businessName?: string;
  accountReference?: string;
  accountName?: string;
  agentNumber?: string;
  storeNumber?: string;
}

export interface NormalizeContext {
  account: Account;
  config: SimulatorConfig;
  variant: string | undefined;
}

export interface NormalizeResult {
  counterparty: Counterparty;
  variant: string | null;
  errors: FieldErrors;
}

export interface TransactionDefinition {
  type: SimulationType;
  displayName: string;
  direction: Direction;
  source: OperationSource;
  /** Statement/detail classification label. */
  statementCategory: string;
  /** Eligible to run fully offline (all initial simulator operations are). */
  offlineEligible: boolean;
  /** Whether the product owner has supplied screen references for this journey. */
  referenceStatus: 'SUPPLIED' | 'AWAITING_REFERENCE';
  normalize(input: CounterpartyInput, ctx: NormalizeContext): NormalizeResult;
}

// ---------- field helpers ----------

const NAME_MAX = 60;

function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function requireText(errors: FieldErrors, field: string, value: string | undefined, label: string, max = NAME_MAX): string {
  const text = cleanText(value);
  if (!text) errors[field] = `${label} is required`;
  else if (text.length > max) errors[field] = `${label} must be at most ${max} characters`;
  return text;
}

function optionalText(errors: FieldErrors, field: string, value: string | undefined, label: string, max = NAME_MAX): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  if (text.length > max) errors[field] = `${label} must be at most ${max} characters`;
  return text;
}

function requirePhone(errors: FieldErrors, field: string, value: string | undefined, label = 'Phone number'): string {
  const raw = cleanText(value);
  if (!raw) {
    errors[field] = `${label} is required`;
    return '';
  }
  const normalized = normalizeKenyanPhone(raw);
  if (!normalized) errors[field] = `Enter a valid Kenyan mobile number`;
  return normalized ?? '';
}

function requireDigits(
  errors: FieldErrors, field: string, value: string | undefined, label: string, minLen: number, maxLen: number,
): string {
  const raw = (value ?? '').replace(/\s+/g, '');
  if (!raw) errors[field] = `${label} is required`;
  else if (!/^\d+$/.test(raw) || raw.length < minLen || raw.length > maxLen) {
    errors[field] = minLen === maxLen ? `${label} must be ${minLen} digits` : `${label} must be ${minLen}–${maxLen} digits`;
  }
  return raw;
}

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')) as T;
}

// ---------- definitions ----------

const sendMoney: TransactionDefinition = {
  type: 'SEND_MONEY',
  displayName: 'Send Money',
  direction: 'DEBIT',
  source: 'TRANSACTION',
  statementCategory: 'Customer Send Money',
  offlineEligible: true,
  referenceStatus: 'SUPPLIED',
  normalize(input) {
    const errors: FieldErrors = {};
    const phone = requirePhone(errors, 'phone', input.phone);
    // No real recipient lookup exists, so the simulated recipient name is entered by the user.
    const name = requireText(errors, 'name', input.name, 'Recipient name');
    return { counterparty: compact({ phone, name }), variant: null, errors };
  },
};

const pochi: TransactionDefinition = {
  type: 'POCHI',
  displayName: 'Pochi la Biashara',
  direction: 'DEBIT',
  source: 'TRANSACTION',
  statementCategory: 'Pochi la Biashara Payment',
  offlineEligible: true,
  referenceStatus: 'SUPPLIED',
  normalize(input) {
    const errors: FieldErrors = {};
    const phone = requirePhone(errors, 'phone', input.phone);
    const name = requireText(errors, 'name', input.name, 'Business name');
    return { counterparty: compact({ phone, name }), variant: null, errors };
  },
};

const buyGoods: TransactionDefinition = {
  type: 'BUY_GOODS',
  displayName: 'Buy Goods',
  direction: 'DEBIT',
  source: 'TRANSACTION',
  statementCategory: 'Customer Merchant Payment',
  offlineEligible: true,
  referenceStatus: 'SUPPLIED',
  normalize(input) {
    const errors: FieldErrors = {};
    const tillNumber = requireDigits(errors, 'tillNumber', input.tillNumber, 'Till number', 5, 8);
    const name = requireText(errors, 'name', input.name, 'Merchant name');
    return { counterparty: compact({ tillNumber, name }), variant: null, errors };
  },
};

const paybill: TransactionDefinition = {
  type: 'PAYBILL',
  displayName: 'Paybill',
  direction: 'DEBIT',
  source: 'TRANSACTION',
  statementCategory: 'Pay Bill',
  offlineEligible: true,
  referenceStatus: 'SUPPLIED',
  normalize(input) {
    const errors: FieldErrors = {};
    const paybillNumber = requireDigits(errors, 'paybillNumber', input.paybillNumber, 'Paybill number', 5, 7);
    const businessName = requireText(errors, 'businessName', input.businessName, 'Business name');
    const accountReference = requireText(errors, 'accountReference', input.accountReference, 'Account number', 20);
    if (accountReference && !/^[A-Za-z0-9 #./-]+$/.test(accountReference)) {
      errors.accountReference = 'Account number contains unsupported characters';
    }
    const accountName = optionalText(errors, 'accountName', input.accountName, 'Account name');
    return { counterparty: compact({ paybillNumber, businessName, accountReference, accountName }), variant: null, errors };
  },
};

const withdraw: TransactionDefinition = {
  type: 'WITHDRAW',
  displayName: 'Withdraw Money',
  direction: 'DEBIT',
  source: 'TRANSACTION',
  statementCategory: 'Customer Withdrawal At Agent Till',
  offlineEligible: true,
  // Fields below are provisional until the withdrawal journey screenshots are supplied.
  referenceStatus: 'AWAITING_REFERENCE',
  normalize(input) {
    const errors: FieldErrors = {};
    const agentNumber = requireDigits(errors, 'agentNumber', input.agentNumber, 'Agent number', 5, 7);
    const storeNumber = input.storeNumber
      ? requireDigits(errors, 'storeNumber', input.storeNumber, 'Store number', 1, 7)
      : undefined;
    const name = optionalText(errors, 'name', input.name, 'Agent name');
    return { counterparty: compact({ agentNumber, storeNumber, name }), variant: null, errors };
  },
};

const airtime: TransactionDefinition = {
  type: 'AIRTIME',
  displayName: 'Airtime Top Up',
  direction: 'DEBIT',
  source: 'TRANSACTION',
  statementCategory: 'Airtime Purchase',
  offlineEligible: true,
  referenceStatus: 'SUPPLIED',
  normalize(input, ctx) {
    const errors: FieldErrors = {};
    const target: AirtimeTarget = ctx.variant === 'OTHER' ? 'OTHER' : 'OWN';
    const phone = target === 'OWN' ? ctx.account.phoneNumber : requirePhone(errors, 'phone', input.phone);
    return { counterparty: compact({ phone }), variant: target, errors };
  },
};

const recharge: TransactionDefinition = {
  type: 'RECHARGE',
  displayName: 'Account Recharge',
  direction: 'CREDIT',
  source: 'GENERAL_OPERATIONS',
  statementCategory: 'Simulated Account Recharge',
  offlineEligible: true,
  referenceStatus: 'SUPPLIED',
  normalize(input, ctx) {
    const errors: FieldErrors = {};
    const customName = optionalText(errors, 'name', input.name, 'Sender name');
    const customPhoneRaw = cleanText(input.phone);
    // User-configured defaults take precedence over the configured Paspesa default (§10.2).
    const defaults = ctx.account.rechargeSenderDefaults ?? ctx.config.defaultRechargeSender;
    let phone = defaults.phone;
    if (customPhoneRaw) {
      const normalized = normalizeKenyanPhone(customPhoneRaw);
      if (!normalized) errors.phone = 'Enter a valid Kenyan mobile number';
      else phone = normalized;
    }
    // A custom phone without a custom name keeps the default name.
    const name = customName ?? defaults.name;
    return { counterparty: { name, phone }, variant: null, errors };
  },
};

export const TRANSACTION_CATALOGUE: Record<SimulationType, TransactionDefinition> = {
  SEND_MONEY: sendMoney,
  POCHI: pochi,
  BUY_GOODS: buyGoods,
  PAYBILL: paybill,
  WITHDRAW: withdraw,
  AIRTIME: airtime,
  RECHARGE: recharge,
};

export function getDefinition(type: SimulationType): TransactionDefinition {
  const def = TRANSACTION_CATALOGUE[type];
  if (!def) throw new Error(`Unsupported transaction type: ${String(type)}`);
  return def;
}

/**
 * Stable identity of a counterparty within a transaction type, used for favourites/frequents.
 * Returns null where a type has no reusable counterparty (e.g. own-number airtime, recharge).
 */
export function counterpartyKey(type: TransactionType, variant: string | null, c: Counterparty): string | null {
  switch (type) {
    case 'SEND_MONEY':
    case 'POCHI':
      return c.phone ?? null;
    case 'BUY_GOODS':
      return c.tillNumber ?? null;
    case 'PAYBILL':
      return c.paybillNumber && c.accountReference ? `${c.paybillNumber}#${c.accountReference.toUpperCase()}` : null;
    case 'WITHDRAW':
      return c.agentNumber ? `${c.agentNumber}#${c.storeNumber ?? ''}` : null;
    case 'AIRTIME':
      return variant === 'OTHER' ? (c.phone ?? null) : null;
    default:
      return null;
  }
}

/** Title/subtitle used consistently by history, statements, confirmation and detail views. */
export function describeCounterparty(tx: Pick<TransactionRecord, 'type' | 'variant' | 'counterparty'>): {
  title: string;
  subtitle: string;
} {
  const c = tx.counterparty;
  const masked = c.phone ? maskPhone(c.phone) : '';
  switch (tx.type as TransactionType) {
    case 'OPENING_BALANCE':
      return { title: 'Opening Balance', subtitle: 'Simulated account setup' };
    case 'RECHARGE':
      return { title: c.name ?? 'Paspesa', subtitle: masked };
    case 'SEND_MONEY':
    case 'POCHI':
      return { title: c.name ?? '', subtitle: masked };
    case 'BUY_GOODS':
      return { title: c.name ?? '', subtitle: `Till ${c.tillNumber ?? ''}` };
    case 'PAYBILL':
      return { title: c.businessName ?? '', subtitle: `${c.paybillNumber ?? ''} · Acc ${c.accountReference ?? ''}` };
    case 'WITHDRAW':
      return { title: c.name ?? `Agent ${c.agentNumber ?? ''}`, subtitle: `Agent ${c.agentNumber ?? ''}` };
    case 'AIRTIME':
      return { title: 'Airtime Purchase', subtitle: c.phone ? toLocalPhone(c.phone) : '' };
    default:
      return { title: '', subtitle: '' };
  }
}
