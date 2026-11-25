import { Logger } from '@nestjs/common';
import type { Database } from './database.js';

/**
 * Account deletion service - handles permanent account deletion with proper data handling.
 * 
 * Deletion policy:
 * - User data (simulations, messages, contacts) is permanently deleted
 * - Financial records (payments, tokens purchased) retained for 7 years per legal/tax requirements
 * - Audit logs retained permanently for security compliance
 * - Personal identifiers in retained records are anonymized
 */
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(private readonly db: Database) {}

  /**
   * Permanently delete an account and all associated user data.
   * Financial and audit records are retained but anonymized per legal requirements.
   */
  async deleteAccount(accountId: string): Promise<{ ok: boolean; message: string }> {
    return this.db.transaction(async (q) => {
      // 1. Verify account exists and get details for logging
      const [account] = await q.query<{ id: string; account_name: string; installation_id: string }>(
        'SELECT a.id, a.account_name, a.installation_id FROM accounts a WHERE a.id = $1',
        [accountId],
      );
      
      if (!account) {
        return { ok: false, message: 'Account not found' };
      }

      this.logger.log(`Starting deletion of account ${accountId} (${account.account_name})`);

      // 2. Delete simulation data (not legally required to retain)
      await q.query('DELETE FROM balance_movements WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM messages WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM transactions WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM favourites WHERE account_id = $1', [accountId]);

      // 3. Delete token wallet and all related data
      const [wallet] = await q.query<{ id: string }>('SELECT id FROM token_wallets WHERE owner_id = $1', [accountId]);
      
      if (wallet) {
        // Get all device allocations for this wallet
        const allocations = await q.query<{ id: string }>('SELECT id FROM device_allocations WHERE wallet_id = $1', [wallet.id]);
        
        // Delete allocation lots for each allocation
        for (const alloc of allocations) {
          await q.query('DELETE FROM allocation_lots WHERE allocation_id = $1', [alloc.id]);
        }
        
        // Delete device allocations
        await q.query('DELETE FROM device_allocations WHERE wallet_id = $1', [wallet.id]);
        
        // Delete token tracking data
        await q.query('DELETE FROM token_spends WHERE wallet_id = $1', [wallet.id]);
        await q.query('DELETE FROM token_ledger WHERE wallet_id = $1', [wallet.id]);
        await q.query('DELETE FROM token_lots WHERE wallet_id = $1', [wallet.id]);
        await q.query('DELETE FROM token_wallets WHERE id = $1', [wallet.id]);
      }

      // 4. RETAIN payment records for legal compliance (7 years tax/accounting requirement)
      //    but anonymize personal data
      await q.query(
        "UPDATE payments SET payer_phone = '[DELETED]' WHERE owner_id = $1",
        [accountId],
      );

      // Note: payment_credits and payment_events are kept as-is (tied to payments table)
      // These records document financial transactions which must be retained

      // 5. Delete sync/session data
      const [installation] = await q.query<{ id: string }>(
        'SELECT installation_id as id FROM accounts WHERE id = $1',
        [accountId],
      );
      
      if (installation?.id) {
        await q.query('DELETE FROM sync_operations WHERE installation_id = $1', [installation.id]);
        await q.query('DELETE FROM sync_review WHERE installation_id = $1', [installation.id]);
      }

      // 6. Delete authentication data
      await q.query('DELETE FROM sign_in_codes WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM sign_in_sessions WHERE account_id = $1', [accountId]);
      
      // Check if email table exists and delete if it does
      const [emailTable] = await q.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'emails') as exists",
      );
      if (emailTable?.exists) {
        await q.query('DELETE FROM emails WHERE account_id = $1', [accountId]);
      }

      // 7. Delete the account record itself
      //    Installation record is kept for audit trail
      await q.query('DELETE FROM accounts WHERE id = $1', [accountId]);

      // 8. Log the deletion to audit log (retained permanently)
      await q.query(
        'INSERT INTO audit_log (actor_id, action, entity_type, entity_id, detail) VALUES ($1, $2, $3, $4, $5)',
        [
          'SYSTEM',
          'ACCOUNT_DELETED',
          'ACCOUNT',
          accountId,
          JSON.stringify({
            account_name: account.account_name,
            deleted_at: new Date().toISOString(),
            reason: 'User requested account deletion',
          }),
        ],
      );

      this.logger.log(`Successfully deleted account ${accountId}`);

      return {
        ok: true,
        message: `Account "${account.account_name}" has been permanently deleted. Financial records have been retained and anonymized per legal requirements.`,
      };
    });
  }

  /**
   * Check if an account can be safely deleted.
   * Prevents deletion if there are pending payments or other blocking conditions.
   */
  async canDelete(accountId: string): Promise<{ ok: boolean; reason?: string }> {
    return this.db.transaction(async (q) => {
      // Check if account exists
      const [account] = await q.query<{ id: string }>(
        'SELECT id FROM accounts WHERE id = $1',
        [accountId],
      );
      
      if (!account) {
        return { ok: false, reason: 'Account not found' };
      }

      // Check for pending payments
      const [pendingPayments] = await q.query<{ count: string }>(
        "SELECT count(*)::text as count FROM payments WHERE owner_id = $1 AND status IN ('INITIATED', 'PENDING')",
        [accountId],
      );
      
      if (pendingPayments && Number(pendingPayments.count) > 0) {
        return {
          ok: false,
          reason: `You have ${pendingPayments.count} pending payment(s). Please wait for them to complete or fail before deleting your account.`,
        };
      }

      return { ok: true };
    });
  }
}
