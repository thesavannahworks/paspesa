/**
 * Suspending a device or an account from the back office — reversible (owner, 2026-11-18: some users will
 * misuse the app; a suspension must be undoable).
 *
 *  - A suspended DEVICE gets nothing from the server: every request is refused with DEVICE_SUSPENDED, and the
 *    app shows a blocking screen until it is reinstated. Its data stays where it is (uploads wait).
 *  - A suspended ACCOUNT cannot sign in anywhere, and the device holding it is refused (ACCOUNT_SUSPENDED)
 *    except for signing out / signing in with another email. Nothing is deleted; the ledger and tokens stay.
 *  - Reinstating clears the suspension; the app notices on its next request and carries on.
 *
 * Every suspension and reinstatement is written to the audit log with the reason.
 */
import type { Database, Queryable } from './database.js';

export type Block = { code: 'DEVICE_SUSPENDED' | 'ACCOUNT_SUSPENDED'; message: string };

const deviceMessage = (reason: string | null) =>
  `This device has been suspended from Paspesa${reason ? `: ${reason}` : ''}. Contact Paspesa support if you think this is a mistake.`;
const accountMessage = (reason: string | null) =>
  `This Paspesa account has been suspended${reason ? `: ${reason}` : ''}. Contact Paspesa support if you think this is a mistake.`;

/** Why this device may not use the server right now, or null. */
export async function blockFor(q: Queryable, installationId: string): Promise<Block | null> {
  const [r] = await q.query<{ d_at: Date | null; d_reason: string | null; a_at: Date | null; a_reason: string | null }>(
    `SELECT i.suspended_at AS d_at, i.suspended_reason AS d_reason, a.suspended_at AS a_at, a.suspended_reason AS a_reason
     FROM installations i LEFT JOIN accounts a ON a.id = i.account_id WHERE i.id = $1`,
    [installationId],
  );
  if (!r) return null;
  if (r.d_at) return { code: 'DEVICE_SUSPENDED', message: deviceMessage(r.d_reason) };
  if (r.a_at) return { code: 'ACCOUNT_SUSPENDED', message: accountMessage(r.a_reason) };
  return null;
}

/** Is the account of this email suspended? (sign-in is refused) */
export async function emailSuspended(q: Queryable, email: string): Promise<string | null> {
  const [r] = await q.query<{ reason: string | null }>(
    'SELECT a.suspended_reason AS reason FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = $1 AND a.suspended_at IS NOT NULL',
    [email],
  );
  return r ? accountMessage(r.reason) : null;
}

type Target = 'DEVICE' | 'ACCOUNT';
const TABLE: Record<Target, string> = { DEVICE: 'installations', ACCOUNT: 'accounts' };

export class SuspensionService {
  constructor(private readonly db: Database) {}

  /** Suspends (true when something changed). Already suspended: the reason is not overwritten. */
  async suspend(target: Target, id: string, actor: string, reason: string): Promise<boolean> {
    return this.db.transaction(async (q) => {
      const rows = await q.query<{ id: string }>(
        `UPDATE ${TABLE[target]} SET suspended_at = now(), suspended_reason = $2, suspended_by = $3 WHERE id = $1 AND suspended_at IS NULL RETURNING id`,
        [id, reason, actor],
      );
      if (!rows.length) return false;
      await q.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6)', [
        actor, `SUSPEND_${target}`, target, id, JSON.stringify({ suspended: true }), reason,
      ]);
      return true;
    });
  }

  /** Undoes a suspension (true when something changed). */
  async reinstate(target: Target, id: string, actor: string, note: string): Promise<boolean> {
    return this.db.transaction(async (q) => {
      const [before] = await q.query<{ suspended_reason: string | null; suspended_at: Date | null }>(`SELECT suspended_reason, suspended_at FROM ${TABLE[target]} WHERE id = $1 FOR UPDATE`, [id]);
      if (!before?.suspended_at) return false;
      await q.query(`UPDATE ${TABLE[target]} SET suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL WHERE id = $1`, [id]);
      await q.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before_value, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        actor, `REINSTATE_${target}`, target, id, JSON.stringify({ suspendedAt: before.suspended_at, reason: before.suspended_reason }), JSON.stringify({ suspended: false }), note || null,
      ]);
      return true;
    });
  }
}
