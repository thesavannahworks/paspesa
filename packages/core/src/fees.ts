/**
 * Fee schedule resolution (White Paper §13–18).
 * Schedules are data with inclusive integer bands. No screen computes fees itself.
 */

export interface FeeBand {
  /** Inclusive lower bound, whole KSh. */
  min: number;
  /** Inclusive upper bound, whole KSh. */
  max: number;
  fee: number;
}

export interface FeeSchedule {
  id: string;
  name: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  bands: FeeBand[];
}

export type FeeResolution =
  | { ok: true; fee: number; band: FeeBand; scheduleId: string; scheduleVersion: number }
  | { ok: false; reason: 'BELOW_MINIMUM' | 'ABOVE_MAXIMUM' | 'NO_BAND' | 'INVALID_AMOUNT'; min: number; max: number };

/** Returns a list of structural problems; an empty list means the schedule is valid. */
export function validateFeeSchedule(schedule: FeeSchedule): string[] {
  const problems: string[] = [];
  if (schedule.bands.length === 0) problems.push(`${schedule.id}: no bands`);
  const sorted = [...schedule.bands].sort((a, b) => a.min - b.min);
  sorted.forEach((band, i) => {
    if (![band.min, band.max, band.fee].every(Number.isSafeInteger)) {
      problems.push(`${schedule.id}: band ${band.min}-${band.max} has non-integer values`);
    }
    if (band.min > band.max) problems.push(`${schedule.id}: band ${band.min}-${band.max} is inverted`);
    if (band.fee < 0) problems.push(`${schedule.id}: band ${band.min}-${band.max} has a negative fee`);
    const prev = sorted[i - 1];
    if (prev && band.min <= prev.max) {
      problems.push(`${schedule.id}: band ${band.min}-${band.max} overlaps ${prev.min}-${prev.max}`);
    }
  });
  return problems;
}

export function scheduleRange(schedule: FeeSchedule): { min: number; max: number } {
  const mins = schedule.bands.map((b) => b.min);
  const maxes = schedule.bands.map((b) => b.max);
  return { min: Math.min(...mins), max: Math.max(...maxes) };
}

export function resolveFee(schedule: FeeSchedule, amount: number): FeeResolution {
  const { min, max } = scheduleRange(schedule);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT', min, max };
  if (amount < min) return { ok: false, reason: 'BELOW_MINIMUM', min, max };
  if (amount > max) return { ok: false, reason: 'ABOVE_MAXIMUM', min, max };
  const band = schedule.bands.find((b) => amount >= b.min && amount <= b.max);
  // A gap between bands is a configuration error; never silently assign a fee (§14, §15).
  if (!band) return { ok: false, reason: 'NO_BAND', min, max };
  return { ok: true, fee: band.fee, band, scheduleId: schedule.id, scheduleVersion: schedule.version };
}
