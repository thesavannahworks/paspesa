/**
 * Clearing unused device records.
 *
 * Every app install, and every browser or web address the app is opened from, registers its own
 * installation the first time it talks to the server — even before anyone signs in. Testing on one phone
 * with the APK, the web app, Expo and a tunnel therefore leaves many records that hold nothing.
 *
 * A record is "unused" when nothing depends on it:
 *   - nobody is signed in on it, and no account names it as its device;
 *   - it never uploaded anything (no sync operations or review items) and never held tokens;
 *   - it is not suspended or marked lost (those stay for the record);
 *   - it has not been seen for the given number of days.
 * Its expired sign-in codes are removed with it. If that app is opened again it simply registers anew.
 */
import type { Database, Queryable } from './database.js';

/** Unused records idle this long are removed automatically. */
export const AUTO_REMOVE_AFTER_DAYS = 30;
/** Records seen this recently are never removed (someone may be in the middle of signing in). */
const MIN_IDLE_MINUTES = 15;

const UNUSED = `
  i.account_id IS NULL AND i.user_id IS NULL AND i.suspended_at IS NULL AND i.status = 'ACTIVE'
  AND coalesce(i.last_seen_at, i.created_at) < $1
  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.installation_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM sync_operations o WHERE o.installation_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM sync_review r WHERE r.installation_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM device_allocations d WHERE d.device_id = i.id)`;

const cutoff = (days: number, now: Date) =>
  new Date(Math.min(now.getTime() - days * 86_400_000, now.getTime() - MIN_IDLE_MINUTES * 60_000)).toISOString();

export async function countUnusedDevices(db: Queryable, days: number, now = new Date()): Promise<number> {
  const [row] = await db.query<{ n: string }>(`SELECT count(*) AS n FROM installations i WHERE ${UNUSED}`, [cutoff(days, now)]);
  return Number(row?.n ?? 0);
}

/** Removes unused device records idle for at least `days` days; returns how many were removed. */
export async function removeUnusedDevices(db: Database, days: number, now = new Date()): Promise<number> {
  return db.transaction(async (q) => {
    const ids = (await q.query<{ id: string }>(`SELECT i.id FROM installations i WHERE ${UNUSED} FOR UPDATE OF i`, [cutoff(days, now)])).map((r) => r.id);
    if (!ids.length) return 0;
    await q.query('DELETE FROM sign_in_codes WHERE installation_id = ANY($1)', [ids]);
    await q.query('DELETE FROM installations WHERE id = ANY($1)', [ids]);
    return ids.length;
  });
}
