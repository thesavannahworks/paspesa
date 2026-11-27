/**
 * Deleting an account at its holder's request (Data Protection Act 2019 s.26, s.40).
 *
 * The holder confirms in the app with their PIN (checked on the device, where it lives) and a one-time code
 * sent to the account's email (checked here: the PIN never reaches the server). Then, in one transaction:
 *
 *  - Erased: the simulated ledger (transactions, balance movements, messages, favourites), the token wallet
 *    and its history (unused tokens are forfeited), device allocations, uploads waiting in sync and in the
 *    review queue, one-time codes, and the person (`users`: their email). Devices that worked on the
 *    account are detached from it.
 *  - Kept, without personal data: real-money payment records (amount, provider reference, status, time),
 *    because the business must keep its financial records; the payer's phone number is removed. The
 *    account row stays as an anonymous "tombstone" (no name, phone, email or device) so those records and
 *    the audit log still point somewhere. Audit entries about the account keep what was done and when,
 *    but their before/after values (which could hold a name or phone) are erased.
 *
 * Refused while a payment is still being processed, so no paid-for tokens or simulation are lost mid-way.
 */
import type { Database, Queryable } from './database.js';

export class AccountDeletionError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'PAYMENT_PENDING', message: string) {
    super(message);
  }
}

export class AccountDeletionService {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  /** Whether the account can be deleted now (nothing is changed). */
  async check(q: Queryable, accountId: string): Promise<void> {
    const [account] = await q.query<{ id: string }>('SELECT id FROM accounts WHERE id = $1 AND deleted_at IS NULL', [accountId]);
    if (!account) throw new AccountDeletionError('NOT_FOUND', 'Account not found');
    const [pending] = await q.query<{ n: string }>("SELECT count(*) AS n FROM payments WHERE owner_id = $1 AND status IN ('INITIATED', 'PENDING')", [accountId]);
    if (Number(pending?.n ?? 0) > 0) {
      throw new AccountDeletionError('PAYMENT_PENDING', 'A payment is still being processed. Try again once it has completed or failed (usually within a few minutes).');
    }
  }

  /** Deletes the account as described above. `requestedBy` is recorded in the audit log (no personal data). */
  async deleteAccount(accountId: string, requestedBy: string): Promise<void> {
    await this.db.transaction(async (q) => {
      await q.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      await this.check(q, accountId);
      const [person] = await q.query<{ user_id: string | null; email: string | null }>(
        'SELECT a.user_id, u.email FROM accounts a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = $1',
        [accountId],
      );
      const devices = (await q.query<{ id: string }>('SELECT id FROM installations WHERE account_id = $1 OR ($2::text IS NOT NULL AND user_id = $2)', [accountId, person?.user_id ?? null])).map((d) => d.id);

      // The simulated ledger.
      await q.query('DELETE FROM balance_movements WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM messages WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM transactions WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM favourites WHERE account_id = $1', [accountId]);

      // Tokens: the wallet and everything recorded in it (unused tokens are forfeited).
      const [wallet] = await q.query<{ id: string }>('SELECT id FROM token_wallets WHERE owner_id = $1', [accountId]);
      if (wallet) {
        await q.query('DELETE FROM allocation_lots WHERE allocation_id IN (SELECT id FROM device_allocations WHERE wallet_id = $1)', [wallet.id]);
        await q.query('DELETE FROM device_allocations WHERE wallet_id = $1', [wallet.id]);
        await q.query('DELETE FROM token_spends WHERE wallet_id = $1', [wallet.id]);
        await q.query('DELETE FROM token_ledger WHERE wallet_id = $1', [wallet.id]);
        await q.query('DELETE FROM token_lots WHERE wallet_id = $1', [wallet.id]);
        await q.query('DELETE FROM token_wallets WHERE id = $1', [wallet.id]);
      }

      // Uploads: processed-operation records of its devices, and held uploads (they carry names and numbers).
      if (devices.length) {
        await q.query('DELETE FROM sync_operations WHERE installation_id = ANY($1)', [devices]);
        await q.query('DELETE FROM sync_review WHERE installation_id = ANY($1)', [devices]);
      }
      await q.query('DELETE FROM sync_review WHERE payload::text LIKE $1', [`%${accountId}%`]);

      // Real-money payments: kept for the business's records, without the payer's phone number.
      await q.query('UPDATE payments SET payer_phone = NULL WHERE owner_id = $1', [accountId]);
      await q.query("UPDATE payment_events SET detail = NULL WHERE payment_id IN (SELECT id FROM payments WHERE owner_id = $1) AND detail::text ~ '[0-9]{9,}'", [accountId]);

      // Audit entries about the account: what was done and when stays; values that could hold personal data go.
      await q.query("UPDATE audit_log SET before_value = NULL, after_value = NULL WHERE entity_type = 'ACCOUNT' AND entity_id = $1", [accountId]);

      // Devices let go of the account; the person and their codes are erased.
      await q.query('UPDATE installations SET account_id = NULL, user_id = NULL, signed_out_at = coalesce(signed_out_at, $2) WHERE id = ANY($1)', [devices, this.now().toISOString()]);
      await q.query(
        `UPDATE accounts SET account_name = 'Deleted account', phone_number = '', installation_id = NULL, user_id = NULL,
           recharge_sender = NULL, deleted_at = $2, updated_at = $2 WHERE id = $1`,
        [accountId, this.now().toISOString()],
      );
      if (person?.email) await q.query('DELETE FROM sign_in_codes WHERE email = $1', [person.email]);
      if (person?.user_id) await q.query('DELETE FROM users WHERE id = $1', [person.user_id]);

      await q.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, reason) VALUES ($1, $2, $3, $4, $5)', [
        requestedBy, 'DELETE_ACCOUNT', 'ACCOUNT', accountId, 'Deleted at the account holder\'s request (confirmed with an emailed code)',
      ]);
    });
  }
}
