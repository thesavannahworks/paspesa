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
  effectiveFrom: '2026-11-14T00:00:00+03:00',
  effectiveTo: null,
  status: 'ACTIVE',
};

export const DEFAULT_PRICING: PricingConfiguration = { version: 1, rules: [DEFAULT_PRICING_RULE] };

export class PricingConfigError extends Error {}

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
