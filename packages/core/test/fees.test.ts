import { describe, expect, it } from 'vitest';
import {
  AGENT_WITHDRAWAL_SCHEDULE,
  DEFAULT_CONFIG,
  SEND_MONEY_SCHEDULE,
  ZERO_FEE_SCHEDULE,
  getFeeSchedule,
  resolveFee,
  validateFeeSchedule,
  type FeeSchedule,
} from '../src';

function feeOf(schedule: FeeSchedule, amount: number) {
  const r = resolveFee(schedule, amount);
  return r.ok ? r.fee : r.reason;
}

describe('seeded schedules are structurally valid', () => {
  it.each([SEND_MONEY_SCHEDULE, AGENT_WITHDRAWAL_SCHEDULE, ZERO_FEE_SCHEDULE])('$id', (schedule) => {
    expect(validateFeeSchedule(schedule)).toEqual([]);
  });

  it('send-money and withdrawal schedules have no gaps between bands', () => {
    for (const s of [SEND_MONEY_SCHEDULE, AGENT_WITHDRAWAL_SCHEDULE]) {
      s.bands.slice(1).forEach((band, i) => expect(band.min).toBe(s.bands[i]!.max + 1));
    }
  });
});

describe('Send Money schedule (§14) — every boundary below / at / above', () => {
  const table: Array<[number, number, number]> = [
    [1, 100, 0], [101, 500, 7], [501, 1_000, 13], [1_001, 1_500, 23], [1_501, 2_500, 33],
    [2_501, 3_500, 53], [3_501, 5_000, 57], [5_001, 7_500, 78], [7_501, 10_000, 90],
    [10_001, 15_000, 100], [15_001, 20_000, 105], [20_001, 250_000, 108],
  ];
  it.each(table)('KSh %i–%i → fee %i', (min, max, fee) => {
    expect(feeOf(SEND_MONEY_SCHEDULE, min)).toBe(fee);
    expect(feeOf(SEND_MONEY_SCHEDULE, max)).toBe(fee);
    if (min + 1 <= max) expect(feeOf(SEND_MONEY_SCHEDULE, min + 1)).toBe(fee);
    if (max - 1 >= min) expect(feeOf(SEND_MONEY_SCHEDULE, max - 1)).toBe(fee);
  });
  it('rejects amounts outside the supported range instead of assigning a fee', () => {
    expect(feeOf(SEND_MONEY_SCHEDULE, 0)).toBe('INVALID_AMOUNT');
    expect(feeOf(SEND_MONEY_SCHEDULE, 250_001)).toBe('ABOVE_MAXIMUM');
    expect(feeOf(SEND_MONEY_SCHEDULE, 100.5)).toBe('INVALID_AMOUNT');
    expect(feeOf(SEND_MONEY_SCHEDULE, -5)).toBe('INVALID_AMOUNT');
  });
});

describe('Agent withdrawal schedule (§15) — every boundary', () => {
  const table: Array<[number, number, number]> = [
    [50, 100, 11], [101, 500, 29], [501, 1_000, 29], [1_001, 1_500, 29], [1_501, 2_500, 29],
    [2_501, 3_500, 52], [3_501, 5_000, 69], [5_001, 7_500, 87], [7_501, 10_000, 115],
    [10_001, 15_000, 167], [15_001, 20_000, 185], [20_001, 35_000, 197], [35_001, 50_000, 278],
    [50_001, 250_000, 309],
  ];
  it.each(table)('KSh %i–%i → fee %i', (min, max, fee) => {
    expect(feeOf(AGENT_WITHDRAWAL_SCHEDULE, min)).toBe(fee);
    expect(feeOf(AGENT_WITHDRAWAL_SCHEDULE, max)).toBe(fee);
  });
  it('rejects below the KSh 50 minimum and above the maximum', () => {
    expect(feeOf(AGENT_WITHDRAWAL_SCHEDULE, 49)).toBe('BELOW_MINIMUM');
    expect(feeOf(AGENT_WITHDRAWAL_SCHEDULE, 1)).toBe('BELOW_MINIMUM');
    expect(feeOf(AGENT_WITHDRAWAL_SCHEDULE, 250_001)).toBe('ABOVE_MAXIMUM');
  });
});

describe('transaction type → schedule assignment', () => {
  it('Send Money, Pochi and Paybill all use the Send Money schedule (§14 AGREED)', () => {
    for (const type of ['SEND_MONEY', 'POCHI', 'PAYBILL'] as const) {
      expect(getFeeSchedule(DEFAULT_CONFIG, type).id).toBe('SEND_MONEY');
    }
  });
  it('Buy Goods has a zero customer fee across its full range (§16 AGREED)', () => {
    const s = getFeeSchedule(DEFAULT_CONFIG, 'BUY_GOODS');
    for (const amount of [1, 100, 101, 2_500, 10_000, 250_000]) expect(feeOf(s, amount)).toBe(0);
    expect(feeOf(s, 250_001)).toBe('ABOVE_MAXIMUM');
  });
  it('Airtime has a zero fee (product-owner decision) with a 250,000 maximum', () => {
    const s = getFeeSchedule(DEFAULT_CONFIG, 'AIRTIME');
    expect(feeOf(s, 1)).toBe(0);
    expect(feeOf(s, 250_000)).toBe(0);
    expect(feeOf(s, 250_001)).toBe('ABOVE_MAXIMUM');
  });
  it('Withdraw uses the agent withdrawal schedule (§15 AGREED)', () => {
    expect(getFeeSchedule(DEFAULT_CONFIG, 'WITHDRAW').id).toBe('AGENT_WITHDRAWAL');
  });
});

describe('schedule validation catches configuration mistakes', () => {
  it('detects overlapping and inverted bands', () => {
    const bad: FeeSchedule = {
      ...SEND_MONEY_SCHEDULE,
      id: 'BAD',
      bands: [{ min: 1, max: 100, fee: 0 }, { min: 100, max: 50, fee: 5 }],
    };
    expect(validateFeeSchedule(bad).length).toBeGreaterThan(0);
  });
  it('never assigns a fee to an amount that falls in a gap', () => {
    const gappy: FeeSchedule = { ...SEND_MONEY_SCHEDULE, bands: [{ min: 1, max: 10, fee: 0 }, { min: 20, max: 30, fee: 1 }] };
    expect(feeOf(gappy, 15)).toBe('NO_BAND');
  });
});
