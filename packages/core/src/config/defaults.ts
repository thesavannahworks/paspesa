import type { FeeSchedule } from '../fees';
import { DEFAULT_MONETIZATION_SETTINGS, DEFAULT_PRICING, type MonetizationSettings, type PricingConfiguration } from '../pricing';
import type { SimulationType } from '../types';

/**
 * Simulator configuration. Seeded from White Paper v0.3 and product-owner decisions.
 * Later this is delivered/updated by the backend (admin-managed), versioned,
 * and snapshotted locally for offline use.
 */
export interface SimulatorConfig {
  version: number;
  currency: 'KES';
  /** Kenya time (EAT, UTC+3). */
  utcOffsetMinutes: number;
  /** Maximum opening balance (product-owner decision: KSh 250,000). */
  maxOpeningBalance: number;
  /** Default sender for General Operations recharge (White Paper §10.2). Users can override per account. */
  defaultRechargeSender: { name: string; phone: string };
  /**
   * Simulated PIN behaviour (back-office configurable).
   * USER_PIN (default): user sets a 4-digit Paspesa PIN at setup; a wrong PIN is rejected.
   * ANY_PIN: any 4 digits are accepted and nothing is stored.
   */
  pinMode: 'USER_PIN' | 'ANY_PIN';
  /** Simulated airtime balance cap (product-owner decision: KSh 1,000). */
  maxAirtimeBalance: number;
  /** A counterparty used at least this many times counts as a frequent/favourite. */
  frequentThreshold: number;
  /**
   * M-PESA daily transaction allowance, used ONLY for the message line "Amount you can transact
   * within the day is …" (500,000 less the day's payments, fees excluded — reference 08-messages).
   * Not enforced: Paspesa has no daily limit (product-owner decision).
   */
  dailyTransactionLimit: number;
  feeSchedules: FeeSchedule[];
  /** Which fee schedule each transaction type uses. */
  feeScheduleByType: Record<SimulationType, string>;
  /** Paspesa token pricing (§27), delivered by the backend. */
  pricing: PricingConfiguration;
  /** Back-office monetization settings (payment switch, offline-free rule, authorization length). */
  monetization: MonetizationSettings;
}

const EFFECTIVE_FROM = '2026-11-14T00:00:00+03:00';

/** §14 — AGREED: used by Send Money, Pochi la Biashara and Paybill. */
export const SEND_MONEY_SCHEDULE: FeeSchedule = {
  id: 'SEND_MONEY',
  name: 'Send Money / Pochi / Paybill (Paspesa reference)',
  version: 1,
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  status: 'ACTIVE',
  bands: [
    { min: 1, max: 100, fee: 0 },
    { min: 101, max: 500, fee: 7 },
    { min: 501, max: 1_000, fee: 13 },
    { min: 1_001, max: 1_500, fee: 23 },
    { min: 1_501, max: 2_500, fee: 33 },
    { min: 2_501, max: 3_500, fee: 53 },
    { min: 3_501, max: 5_000, fee: 57 },
    { min: 5_001, max: 7_500, fee: 78 },
    { min: 7_501, max: 10_000, fee: 90 },
    { min: 10_001, max: 15_000, fee: 100 },
    { min: 15_001, max: 20_000, fee: 105 },
    { min: 20_001, max: 250_000, fee: 108 },
  ],
};

/** §15 — AGREED: agent withdrawal. */
export const AGENT_WITHDRAWAL_SCHEDULE: FeeSchedule = {
  id: 'AGENT_WITHDRAWAL',
  name: 'Agent withdrawal (Paspesa reference)',
  version: 1,
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  status: 'ACTIVE',
  bands: [
    { min: 50, max: 100, fee: 11 },
    { min: 101, max: 500, fee: 29 },
    { min: 501, max: 1_000, fee: 29 },
    { min: 1_001, max: 1_500, fee: 29 },
    { min: 1_501, max: 2_500, fee: 29 },
    { min: 2_501, max: 3_500, fee: 52 },
    { min: 3_501, max: 5_000, fee: 69 },
    { min: 5_001, max: 7_500, fee: 87 },
    { min: 7_501, max: 10_000, fee: 115 },
    { min: 10_001, max: 15_000, fee: 167 },
    { min: 15_001, max: 20_000, fee: 185 },
    { min: 20_001, max: 35_000, fee: 197 },
    { min: 35_001, max: 50_000, fee: 278 },
    { min: 50_001, max: 250_000, fee: 309 },
  ],
};

/**
 * Zero customer fee, KSh 1–250,000.
 * Buy Goods (§16 AGREED), Airtime (product-owner decision) and Recharge (incoming).
 */
export const ZERO_FEE_SCHEDULE: FeeSchedule = {
  id: 'ZERO_FEE',
  name: 'No customer fee',
  version: 1,
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  status: 'ACTIVE',
  bands: [{ min: 1, max: 250_000, fee: 0 }],
};

export const DEFAULT_CONFIG: SimulatorConfig = {
  version: 1,
  currency: 'KES',
  utcOffsetMinutes: 180,
  maxOpeningBalance: 250_000,
  defaultRechargeSender: {
    name: 'Paspesa',
    // OPEN: the product owner to confirm the default Paspesa sender number.
    phone: '254700000000',
  },
  pinMode: 'USER_PIN',
  maxAirtimeBalance: 1_000,
  frequentThreshold: 3,
  dailyTransactionLimit: 500_000,
  feeSchedules: [SEND_MONEY_SCHEDULE, AGENT_WITHDRAWAL_SCHEDULE, ZERO_FEE_SCHEDULE],
  feeScheduleByType: {
    SEND_MONEY: 'SEND_MONEY',
    POCHI: 'SEND_MONEY',
    PAYBILL: 'SEND_MONEY',
    BUY_GOODS: 'ZERO_FEE',
    AIRTIME: 'ZERO_FEE',
    WITHDRAW: 'AGENT_WITHDRAWAL',
    RECHARGE: 'ZERO_FEE',
  },
  pricing: DEFAULT_PRICING,
  monetization: DEFAULT_MONETIZATION_SETTINGS,
};

export function getFeeSchedule(config: SimulatorConfig, type: SimulationType): FeeSchedule {
  const id = config.feeScheduleByType[type];
  const schedule = config.feeSchedules.find((s) => s.id === id && s.status === 'ACTIVE');
  if (!schedule) throw new Error(`No active fee schedule "${id}" configured for ${type}`);
  return schedule;
}
