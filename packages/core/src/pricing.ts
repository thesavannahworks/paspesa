/**
 * Pricing engine (White Paper §27): how many Paspesa tokens a simulation costs.
 *
 * Formulas (A = simulated amount, F = free threshold, D = amount per token):
 *   FULL_AMOUNT   (agreed default)  T = 0 if A ≤ F, else ⌈A / D⌉
 *   EXCESS_AMOUNT                   T = 0 if A ≤ F, else ⌈(A − F) / D⌉
 *   TIERED                          T = cost of the configured range containing A
 * Defaults (AGREED): F = KSh 20, D = KSh 5, FULL_AMOUNT.
 *
 * Precedence (§27.4): account + type → account default → global type → global default.
 * Every price is returned with a snapshot of the rule and version used (§27.5), so later configuration
 * changes never alter historical costs. The backend is authoritative for pricing (§27.6).
 *
 * Product-owner decisions (2026-11-17):
 *  - 1 token = KSh 1. A pay-per-simulation costs the token cost in shillings (20 tokens → KSh 20), and
 *    buying tokens is "pay KSh N, get N tokens" (no fixed packages).
 *  - Recharge (General Operations top-up) is never priced: charging happens per transaction simulation.
 *  - Whether free simulations (0 tokens) may run offline is a back-office setting.
 */
import type { PricingSnapshot, SimulationType } from './types';

export type PricingFormula = 'FULL_AMOUNT' | 'EXCESS_AMOUNT' | 'TIERED';

/** One amount range (whole shillings, inclusive). `max: null` = no upper limit. */
export interface PricingTier {
  min: number;
  max: number | null;
  tokens: number;
}

export interface PricingRule {
  id: string;
  scopeType: 'GLOBAL' | 'ACCOUNT';
  /** Account ID for ACCOUNT scope; null for GLOBAL. */
  scopeId: string | null;
  /** null = the scope's default for every transaction type. */
  transactionType: SimulationType | null;
  formula: PricingFormula;
  freeThreshold: number;
  /** D for FULL_AMOUNT / EXCESS_AMOUNT; null for TIERED. */
  amountPerToken: number | null;
  /** For TIERED only. */
  tiers: PricingTier[] | null;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface PricingConfiguration {
  /** Increases with every change to any rule. */
  version: number;
  rules: PricingRule[];
}

/** The agreed default (§27.1): full amount, free up to KSh 20, KSh 5 per token. */
export const DEFAULT_PRICING_RULE: PricingRule = {
  id: 'global-default',
  scopeType: 'GLOBAL',
  scopeId: null,
  transactionType: null,
  formula: 'FULL_AMOUNT',
  freeThreshold: 20,
  amountPerToken: 5,
  tiers: null,
  version: 1,
  // The agreed default applies from the start (any simulation date).
  effectiveFrom: '2020-01-01T00:00:00+03:00',
  effectiveTo: null,
  status: 'ACTIVE',
};

export const DEFAULT_PRICING: PricingConfiguration = { version: 1, rules: [DEFAULT_PRICING_RULE] };

export class PricingConfigError extends Error {}

/** Shillings per token (AGREED 2026-11-17: 1 token = KSh 1). */
export const SHILLINGS_PER_TOKEN = 1;

/** Simulations that cost tokens. Recharge is free: charging is per transaction simulation (owner decision). */
export const PRICED_TYPES: readonly SimulationType[] = ['SEND_MONEY', 'POCHI', 'BUY_GOODS', 'PAYBILL', 'WITHDRAW', 'AIRTIME'];

/** Back-office monetization settings, delivered to devices with the pricing configuration. */
export interface MonetizationSettings {
  /** Off until activation: while false every simulation runs free (UNMETERED). */
  paymentRequired: boolean;
  /** Free simulations (0 tokens) may run offline without a device token allocation (§29.6, owner: yes). */
  freeSimulationsOffline: boolean;
  /** 1 token = KSh 1. */
  shillingsPerToken: number;
  /** Smallest token purchase in shillings. */
  minimumPurchase: number;
  /** How long a device may spend its allocation offline before renewing online (§29.4, default 3 days). */
  offlineAuthorizationDays: number;
  /** Control which transaction types are enabled (map of SimulationType -> boolean). Empty = all enabled. */
  transactionTypeControls?: Record<string, boolean>;
  /** Control which payment methods are available. */
  paymentMethodControls?: {
    /** Tokens payment method enabled (from device allocation + central balance). */
    tokensEnabled: boolean;
    /** Direct pay-per-simulation enabled (M-PESA prompt for individual simulation). */
    directPayEnabled: boolean;
  };
  /** Active payment provider (mpesa-daraja, payhero, kopokopo, intasend, paystack). */
  activePaymentProvider?: string | null;
}

export const DEFAULT_MONETIZATION_SETTINGS: MonetizationSettings = {
  paymentRequired: false,
  freeSimulationsOffline: true,
  shillingsPerToken: SHILLINGS_PER_TOKEN,
  minimumPurchase: 1,
  offlineAuthorizationDays: 3,
  transactionTypeControls: {},
  paymentMethodControls: {
    tokensEnabled: true,
    directPayEnabled: true,
  },
  activePaymentProvider: null,
};

/** Shilling price of a pay-per-simulation: its token cost at the token rate. */
export const directPrice = (pricing: PricingSnapshot, settings: Pick<MonetizationSettings, 'shillingsPerToken'> = DEFAULT_MONETIZATION_SETTINGS) =>
  pricing.tokenCost * settings.shillingsPerToken;

/** Tokens received for a purchase of `shillings`. */
export const tokensForShillings = (shillings: number, settings: Pick<MonetizationSettings, 'shillingsPerToken'> = DEFAULT_MONETIZATION_SETTINGS) =>
  Math.floor(shillings / settings.shillingsPerToken);

/** May this simulation run offline without a token allocation? Only free ones, and only if the setting allows. */
export const mayRunOfflineWithoutAllocation = (pricing: PricingSnapshot, settings: MonetizationSettings) =>
  pricing.tokenCost === 0 && settings.freeSimulationsOffline;

/** Checks a rule is usable. Returns the problems found (empty = valid). */
export function validatePricingRule(rule: PricingRule): string[] {
  const problems: string[] = [];
  const whole = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (rule.scopeType === 'ACCOUNT' && !rule.scopeId) problems.push('An account rule needs an account ID');
  if (rule.scopeType === 'GLOBAL' && rule.scopeId) problems.push('A global rule cannot name an account');
  if (!whole(rule.freeThreshold)) problems.push('Free threshold must be a whole number of shillings');
  if (rule.formula === 'TIERED') {
    const tiers = rule.tiers ?? [];
    if (!tiers.length) problems.push('Tiered pricing needs at least one range');
    let expected = 0;
    tiers.forEach((t, i) => {
      if (!whole(t.min) || (t.max !== null && !whole(t.max)) || !whole(t.tokens)) problems.push(`Range ${i + 1} must use whole numbers`);
      if (t.min !== expected) problems.push(`Range ${i + 1} must start at KSh ${expected} (no gaps or overlaps)`);
      if (t.max !== null && t.max < t.min) problems.push(`Range ${i + 1} ends before it starts`);
      if (t.max === null && i !== tiers.length - 1) problems.push('Only the last range can be open-ended');
      expected = t.max === null ? expected : t.max + 1;
    });
  } else if (!(typeof rule.amountPerToken === 'number' && Number.isSafeInteger(rule.amountPerToken) && rule.amountPerToken > 0)) {
    problems.push('Amount per token must be a whole number above zero');
  }
  return problems;
}

/** Tokens for an amount under one rule. */
export function tokenCost(rule: PricingRule, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new PricingConfigError('Amount must be whole shillings');
  switch (rule.formula) {
    case 'FULL_AMOUNT':
      return amount <= rule.freeThreshold ? 0 : Math.ceil(amount / rule.amountPerToken!);
    case 'EXCESS_AMOUNT':
      return amount <= rule.freeThreshold ? 0 : Math.ceil((amount - rule.freeThreshold) / rule.amountPerToken!);
    case 'TIERED': {
      const tier = (rule.tiers ?? []).find((t) => amount >= t.min && (t.max === null || amount <= t.max));
      if (!tier) throw new PricingConfigError(`No pricing range covers KSh ${amount}`);
      return tier.tokens;
    }
  }
}

const activeAt = (r: PricingRule, at: string) =>
  r.status === 'ACTIVE' && Date.parse(r.effectiveFrom) <= Date.parse(at) && (r.effectiveTo === null || Date.parse(at) < Date.parse(r.effectiveTo));

/** The rule that applies, following the §27.4 precedence. */
export function resolvePricingRule(config: PricingConfiguration, input: { accountId: string; type: SimulationType; at: string }): PricingRule {
  const active = config.rules.filter((r) => activeAt(r, input.at));
  const latest = (rules: PricingRule[]) => rules.sort((a, b) => b.version - a.version)[0];
  const levels = [
    active.filter((r) => r.scopeType === 'ACCOUNT' && r.scopeId === input.accountId && r.transactionType === input.type),
    active.filter((r) => r.scopeType === 'ACCOUNT' && r.scopeId === input.accountId && r.transactionType === null),
    active.filter((r) => r.scopeType === 'GLOBAL' && r.transactionType === input.type),
    active.filter((r) => r.scopeType === 'GLOBAL' && r.transactionType === null),
  ];
  for (const level of levels) {
    const rule = latest(level);
    if (rule) return rule;
  }
  throw new PricingConfigError('No active global pricing rule');
}

/** Price of one simulation, with the snapshot that must be stored with it (§27.5). */
export function priceSimulation(config: PricingConfiguration, input: { accountId: string; type: SimulationType; amount: number; at: string }): PricingSnapshot {
  if (!PRICED_TYPES.includes(input.type)) {
    return {
      formula: 'FULL_AMOUNT', freeThreshold: 0, amountPerToken: null, tierConfiguration: null, resolvedRule: `not-priced (${input.type})`,
      accountOverride: null, configVersion: config.version, tokenCost: 0, appliedConfigAt: input.at,
    };
  }
  const rule = resolvePricingRule(config, input);
  return {
    formula: rule.formula,
    freeThreshold: rule.freeThreshold,
    amountPerToken: rule.amountPerToken,
    tierConfiguration: rule.tiers,
    resolvedRule: `${rule.id}@v${rule.version}${rule.transactionType ? ` (${rule.transactionType})` : ''}`,
    accountOverride: rule.scopeType === 'ACCOUNT' ? rule.id : null,
    configVersion: config.version,
    tokenCost: tokenCost(rule, input.amount),
    appliedConfigAt: rule.effectiveFrom,
  };
}

/**
 * Token Calculator (app and back office): what a simulation of `amount` costs, and the largest amount
 * `tokens` can pay for, both under the rule that applies to this account and type now. Amounts are capped
 * at `limit` (the largest amount Paspesa simulates).
 */
export function calculateTokens(
  config: PricingConfiguration,
  settings: Pick<MonetizationSettings, 'shillingsPerToken'>,
  input: { accountId: string; type: SimulationType; amount: number; tokens: number; at: string; limit?: number },
): { tokenCost: number; shillings: number; maxAmount: number; rule: PricingRule | null } {
  const limit = input.limit ?? 250_000;
  const amount = Math.min(Math.max(0, Math.floor(input.amount)), limit);
  const tokens = Math.max(0, Math.floor(input.tokens));
  if (!PRICED_TYPES.includes(input.type)) return { tokenCost: 0, shillings: 0, maxAmount: limit, rule: null };
  const rule = resolvePricingRule(config, input);
  const cost = (() => {
    try {
      return tokenCost(rule, amount);
    } catch {
      return 0; // an amount no range covers is not priced
    }
  })();
  let maxAmount: number;
  switch (rule.formula) {
    case 'FULL_AMOUNT':
      maxAmount = Math.max(rule.freeThreshold, tokens * rule.amountPerToken!);
      break;
    case 'EXCESS_AMOUNT':
      maxAmount = rule.freeThreshold + tokens * rule.amountPerToken!;
      break;
    case 'TIERED':
      maxAmount = Math.max(0, ...(rule.tiers ?? []).filter((t) => t.tokens <= tokens).map((t) => t.max ?? limit));
      break;
  }
  return { tokenCost: cost, shillings: cost * settings.shillingsPerToken, maxAmount: Math.min(maxAmount, limit), rule };
}
