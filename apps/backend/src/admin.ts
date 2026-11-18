/**
 * Server-side admin commands. The back office at /admin covers day-to-day work (§34–35); this CLI
 * creates the first back-office user and stays available for scripting.
 * Runs directly against the database on the server machine; every change is audited as `admin:cli`.
 *
 *   npm run admin -w @paspesa/backend -- pricing:show
 *   npm run admin -w @paspesa/backend -- pricing:set '{"id":"global-paybill","scopeType":"GLOBAL","scopeId":null,"transactionType":"PAYBILL","formula":"FULL_AMOUNT","freeThreshold":20,"amountPerToken":10,"tiers":null,"effectiveFrom":"2026-12-01T00:00:00+03:00","effectiveTo":null,"status":"ACTIVE"}'
 *   npm run admin -w @paspesa/backend -- tokens:grant <accountId> <PROMOTIONAL|ADMIN> <quantity> <reference> [expiresAt]
 *   npm run admin -w @paspesa/backend -- tokens:expire
 *   npm run admin -w @paspesa/backend -- wallet:show <accountId>
 *   npm run admin -w @paspesa/backend -- wallet:reconcile <accountId>
 *   npm run admin -w @paspesa/backend -- accounts
 *   npm run admin -w @paspesa/backend -- devices
 *   npm run admin -w @paspesa/backend -- device:lost <installationId> "<reason>"
 *   npm run admin -w @paspesa/backend -- settings:show
 *   npm run admin -w @paspesa/backend -- settings:set freeSimulationsOffline false
 *   npm run admin -w @paspesa/backend -- admin:create you@example.com "Your Name" ADMIN '<password>'   (first back-office user)
 *   npm run admin -w @paspesa/backend -- admin:list
 *   npm run admin -- trace <email | phone | accountId> [hours]   (an account's recent story, for debugging)
 *   npm run admin -- review:list
 *   npm run admin -- tokens:unpaid <email | phone | accountId> [--charge]
 *       token-paid simulations stored without their tokens being taken (the review "Apply" bug fixed on
 *       2026-11-18). Lists them; with --charge takes each one's tokens from the central balance (audited).
 *
 * Uses DATABASE_URL, or the embedded database in PGLITE_DIR (default ./.data/pglite). Stop the running
 * backend first when using the embedded database (it allows one process at a time).
 */
import type { PricingRule, PricingSnapshot, TokenCategory } from '@paspesa/core';

// Settings and secrets (DATABASE_URL, MPESA_*) from apps/backend/.env when present (git-ignored).
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file: use the environment as is
}
import { openDatabase } from './database.js';
import { AllocationService } from './allocation.service.js';
import { MonetizationService } from './monetization.service.js';
import { AdminAuth, type AdminRole } from './admin/auth.js';

const [command, ...args] = process.argv.slice(2);
const db = await openDatabase(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : { pgliteDir: process.env.PGLITE_DIR ?? './.data/pglite' });
const money = new MonetizationService(db);
const actor = 'admin:cli';
const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

try {
  switch (command) {
    case 'pricing:show':
      print(await money.pricing());
      break;
    case 'pricing:set':
      print(await money.publishRule(JSON.parse(args[0] ?? '') as Omit<PricingRule, 'version'>, actor));
      break;
    case 'tokens:grant': {
      const [accountId, category, quantity, reference, expiresAt] = args;
      if (category !== 'PROMOTIONAL' && category !== 'ADMIN') throw new Error('Grant PROMOTIONAL or ADMIN tokens (purchased tokens come only from verified payments)');
      print(await money.grant({ accountId: accountId!, category: category as TokenCategory, quantity: Number(quantity), reference: reference!, expiresAt: expiresAt ?? null, actor }));
      break;
    }
    case 'tokens:expire':
      print({ expired: await money.expireDue() });
      break;
    case 'wallet:show':
      print(await money.wallet(args[0]!));
      break;
    case 'wallet:reconcile': {
      const problems = await money.reconcile(args[0]!);
      print(problems.length ? { consistent: false, problems } : { consistent: true });
      break;
    }
    case 'devices':
      print(await db.query(
        `SELECT i.id AS installation_id, i.platform, i.label, i.status, i.last_seen_at, a.account_name,
                d.allocated_quantity, d.spent_quantity, d.authorization_expires_at
         FROM installations i LEFT JOIN accounts a ON a.installation_id = i.id
         LEFT JOIN device_allocations d ON d.device_id = i.id AND d.status = 'ACTIVE' ORDER BY i.created_at`,
      ));
      break;
    case 'device:lost':
      print(await new AllocationService(db, money).forfeitLostDevice(args[0]!, actor, args[1] ?? 'Reported lost'));
      break;
    case 'settings:show':
      print(await money.settings());
      break;
    case 'settings:set': {
      const [key, raw] = args;
      const value = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
      print(await money.updateSettings({ [key!]: value }, actor));
      break;
    }
    case 'admin:create': {
      // the first back-office user (later ones can be added from /admin/users)
      const [email, name, role, password] = args;
      if (!['ADMIN', 'OPERATOR', 'VIEWER'].includes(role ?? '')) throw new Error('Usage: admin:create <email> "<name>" <ADMIN|OPERATOR|VIEWER> <password>');
      const user = await new AdminAuth(db).createAdmin({ email: email ?? '', name: name ?? '', role: role as AdminRole, password: password ?? '' }, actor);
      print({ created: user.email, role: user.role, signIn: '/admin/login' });
      break;
    }
    case 'admin:list':
      print(await db.query('SELECT email, name, role, status, last_login_at FROM admin_users ORDER BY created_at'));
      break;
    case 'trace': {
      // Everything that happened to an account recently, in time order: for debugging a test session.
      const key = (args[0] ?? '').trim().toLowerCase();
      const hours = Number(args[1] ?? 24);
      const [a] = await db.query<{ id: string; account_name: string; balance: string; version: number; installation_id: string | null; email: string | null }>(
        `SELECT a.id, a.account_name, a.balance, a.version, a.installation_id, u.email FROM accounts a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.id = $1 OR lower(u.email) = $1 OR a.phone_number = $1 OR a.phone_number = '254' || ltrim($1, '0') LIMIT 1`, [key],
      );
      if (!a) throw new Error('No account for that email, phone or ID');
      console.log(`${a.account_name} <${a.email ?? 'not signed in'}>  balance ${a.balance}, transaction #${a.version}, active device ${a.installation_id?.slice(0, 8) ?? 'none'}`);
      const since = `now() - interval '${Math.max(1, Math.min(hours, 24 * 30))} hours'`;
      const events = await db.query<{ at: Date; line: string }>(
        `SELECT signed_in_at AS at, 'device ' || left(id, 8) || ' (' || coalesce(platform, '?') || ') signed in' AS line FROM installations WHERE account_id = $1 AND signed_in_at > ${since}
         UNION ALL SELECT signed_out_at, 'device ' || left(id, 8) || ' signed out' FROM installations WHERE account_id = $1 AND signed_out_at > ${since}
         UNION ALL SELECT completed_at, 'tx #' || sequence || ' ' || type || ' ' || amount || ' → balance ' || balance_after || ' (uploaded ' || to_char(received_at, 'HH24:MI:SS') || ')' FROM transactions WHERE account_id = $1 AND completed_at > ${since}
         UNION ALL SELECT o.processed_at, 'upload from ' || left(o.installation_id, 8) || ': ' || o.operation_type || ' → ' || o.code || coalesce(' — ' || o.message, '')
           FROM sync_operations o JOIN installations i ON i.id = o.installation_id WHERE i.account_id = $1 AND o.processed_at > ${since} AND o.code <> 'APPLIED'
         UNION ALL SELECT r.received_at, 'REVIEW #' || r.id || ' ' || r.code || ': ' || coalesce(r.message, '') || coalesce(' [' || r.action || ': ' || r.resolution || ']', ' [open]')
           FROM sync_review r JOIN installations i ON i.id = r.installation_id WHERE i.account_id = $1 AND r.received_at > ${since}
         UNION ALL SELECT created_at, 'settings: payments ' || CASE WHEN (settings->>'paymentRequired')::boolean THEN 'ON' ELSE 'off' END || ', free offline ' || CASE WHEN (settings->>'freeSimulationsOffline')::boolean THEN 'allowed' ELSE 'not allowed' END
           FROM (SELECT effective_from AS created_at, settings FROM monetization_settings_history) h WHERE created_at > ${since}
         ORDER BY at`,
        [a.id],
      );
      for (const e of events) console.log(`${new Date(e.at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}  ${e.line}`);
      break;
    }
    case 'tokens:unpaid': {
      const key = (args[0] ?? '').trim().toLowerCase();
      const [a] = await db.query<{ id: string }>(
        `SELECT a.id FROM accounts a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.id = $1 OR lower(u.email) = $1 OR a.phone_number = $1 OR a.phone_number = '254' || ltrim($1, '0') LIMIT 1`, [key],
      );
      if (!a) throw new Error('No account for that email, phone or ID');
      const unpaid = await db.query<{ sequence: number; operation_id: string; type: string; amount: string; method: string; cost: string; pricing: PricingSnapshot }>(
        `SELECT t.sequence, t.operation_id, t.type, t.amount, t.record->>'paymentMethod' AS method, (t.record->'pricing'->>'tokenCost') AS cost, t.record->'pricing' AS pricing
         FROM transactions t JOIN token_wallets w ON w.owner_id = t.account_id
         WHERE t.account_id = $1 AND t.record->>'paymentMethod' IN ('TOKENS', 'WALLET') AND (t.record->'pricing'->>'tokenCost')::int > 0
           AND NOT EXISTS (SELECT 1 FROM token_spends s WHERE s.wallet_id = w.id AND s.simulation_id = t.operation_id)
         ORDER BY t.sequence`,
        [a.id],
      );
      print(unpaid.map((u) => ({ transaction: u.sequence, type: u.type, amount: Number(u.amount), paidWith: u.method, tokens: Number(u.cost) })));
      if (!args.includes('--charge')) {
        console.log(unpaid.length ? `Not charged yet. Run again with --charge to take ${unpaid.reduce((n, u) => n + Number(u.cost), 0)} tokens from the central balance.` : 'Nothing unpaid.');
        break;
      }
      for (const u of unpaid) {
        await money.spendForSimulation({ accountId: a.id, simulationId: u.operation_id, pricing: u.pricing });
        await db.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6)', [
          actor, 'CHARGE_UNPAID_SIMULATION', 'ACCOUNT', a.id, JSON.stringify({ sequence: u.sequence, tokens: Number(u.cost) }), 'Stored by review Apply without charging (fixed 2026-11-18)',
        ]);
      }
      print({ charged: unpaid.length, wallet: (await money.wallet(a.id)).balances });
      break;
    }
    case 'review:list':
      print(await db.query("SELECT id, received_at, code, operation_type, message, coalesce(action, 'OPEN') AS state FROM sync_review ORDER BY received_at DESC LIMIT 30"));
      break;
    case 'accounts':
      print(await db.query('SELECT id, installation_id, account_name, phone_number, balance FROM accounts ORDER BY created_at'));
      break;
    default:
      console.log('Commands: pricing:show | pricing:set <json> | tokens:grant <accountId> <PROMOTIONAL|ADMIN> <qty> <reference> [expiresAt] | tokens:expire | wallet:show <accountId> | wallet:reconcile <accountId> | devices | device:lost <installationId> <reason> | settings:show | settings:set <key> <value> | accounts | admin:create <email> <name> <role> <password> | admin:list | trace <email|phone|accountId> [hours] | review:list | tokens:unpaid <email|phone|accountId> [--charge]');
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.close();
}
