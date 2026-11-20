/**
 * Simulated M-PESA fee schedules, editable from the back office (owner, 2026-11-20).
 *
 * Every save is a new version (old versions are kept). Devices receive the current schedules with the pricing
 * and settings they already fetch, and keep them for offline use. Each transaction records the schedule and
 * version it used; the server checks an upload against that version, so a phone that was offline while fees
 * changed is not flagged. A version the server never published is not accepted.
 */
import { DEFAULT_CONFIG, validateFeeSchedule, type FeeBand, type FeeSchedule, type SimulatorConfig, type SyncTransaction } from '@paspesa/core';
import type { Database, Queryable } from './database.js';

interface Row { id: string; version: number; name: string; bands: FeeBand[]; effective_from: Date | string; created_by: string; created_at: Date | string }

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const toSchedule = (r: Row): FeeSchedule => ({ id: r.id, name: r.name, version: Number(r.version), effectiveFrom: iso(r.effective_from), effectiveTo: null, status: 'ACTIVE', bands: r.bands });

export class FeeError extends Error {}

export class FeeService {
  private seeded = false;

  constructor(private readonly db: Database, private readonly now: () => string = () => new Date().toISOString()) {}

  /** The built-in schedules become version 1 the first time. */
  private async seed(q: Queryable = this.db) {
    if (this.seeded) return;
    for (const s of DEFAULT_CONFIG.feeSchedules) {
      await q.query(
        `INSERT INTO fee_schedules (id, version, name, bands, effective_from, created_by) VALUES ($1, $2, $3, $4, $5, 'system')
         ON CONFLICT (id, version) DO NOTHING`,
        [s.id, s.version, s.name, JSON.stringify(s.bands), s.effectiveFrom],
      );
    }
    this.seeded = true;
  }

  /** The current version of every schedule. */
  async current(q: Queryable = this.db): Promise<FeeSchedule[]> {
    await this.seed(q);
    const rows = await q.query<Row>('SELECT DISTINCT ON (id) * FROM fee_schedules ORDER BY id, version DESC');
    return rows.map(toSchedule);
  }

  /** Every version of one schedule, newest first. */
  async history(id: string): Promise<(FeeSchedule & { createdBy: string; createdAt: string })[]> {
    await this.seed();
    const rows = await this.db.query<Row>('SELECT * FROM fee_schedules WHERE id = $1 ORDER BY version DESC', [id]);
    return rows.map((r) => ({ ...toSchedule(r), createdBy: r.created_by, createdAt: iso(r.created_at) }));
  }

  /**
   * The configuration to check an uploaded transaction with: each schedule as it stood when the transaction
   * happened, and the transaction's own schedule at the version it claims (if the server published it).
   */
  async configFor(q: Queryable, base: SimulatorConfig, t: Pick<SyncTransaction, 'feeScheduleId' | 'feeScheduleVersion' | 'completedAt'>): Promise<SimulatorConfig> {
    await this.seed(q); // the caller's transaction (the embedded test database has one connection)
    const at = new Date(Math.min(Date.parse(t.completedAt) || Date.now(), Date.parse(this.now()))).toISOString();
    const rows = await q.query<Row>(
      `SELECT DISTINCT ON (id) * FROM fee_schedules WHERE effective_from <= $1 OR version = 1 ORDER BY id, (effective_from <= $1) DESC, version DESC`,
      [at],
    );
    const schedules = rows.map(toSchedule);
    if (t.feeScheduleId && Number.isSafeInteger(t.feeScheduleVersion)) {
      const [claimed] = await q.query<Row>('SELECT * FROM fee_schedules WHERE id = $1 AND version = $2', [t.feeScheduleId, t.feeScheduleVersion]);
      if (claimed) {
        const i = schedules.findIndex((s) => s.id === claimed.id);
        if (i >= 0) schedules[i] = toSchedule(claimed);
      }
    }
    return { ...base, feeSchedules: schedules.length ? schedules : base.feeSchedules };
  }

  /** Publishes a new version of a schedule (validated: whole shillings, no overlaps, no gaps). Audited. */
  async publish(id: string, bands: FeeBand[], actor: string, reason: string | null = null): Promise<FeeSchedule> {
    await this.seed();
    return this.db.transaction(async (q) => {
      const [latest] = await q.query<Row>('SELECT * FROM fee_schedules WHERE id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE', [id]);
      if (!latest) throw new FeeError('Unknown fee schedule');
      const sorted = [...bands].sort((a, b) => a.min - b.min);
      const next: FeeSchedule = { ...toSchedule(latest), version: Number(latest.version) + 1, effectiveFrom: this.now(), bands: sorted };
      const problems = validateFeeSchedule(next);
      sorted.forEach((b, i) => {
        const prev = sorted[i - 1];
        if (prev && b.min !== prev.max + 1) problems.push(`gap between KSh ${prev.max} and KSh ${b.min} — every amount needs a band`);
      });
      if (problems.length) throw new FeeError(problems.map((p) => p.replace(`${id}: `, '')).join('; '));
      if (JSON.stringify(sorted) === JSON.stringify(latest.bands)) throw new FeeError('Nothing changed');
      await q.query('INSERT INTO fee_schedules (id, version, name, bands, effective_from, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [
        id, next.version, next.name, JSON.stringify(sorted), next.effectiveFrom, actor,
      ]);
      await q.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before_value, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        actor, 'PUBLISH_FEE_SCHEDULE', 'FEE_SCHEDULE', `${id}@${next.version}`, JSON.stringify(latest.bands), JSON.stringify(sorted), reason,
      ]);
      return next;
    });
  }
}
