/**
 * Server-side admin commands (until the admin back office with administrator login exists, §34–35).
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
 *
 * Uses DATABASE_URL, or the embedded database in PGLITE_DIR (default ./.data/pglite). Stop the running
 * backend first when using the embedded database (it allows one process at a time).
 */
import type { PricingRule, TokenCategory } from '@paspesa/core';

// Settings and secrets (DATABASE_URL, MPESA_*) from apps/backend/.env when present (git-ignored).
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file: use the environment as is
}
import { openDatabase } from './database.js';
import { AllocationService } from './allocation.service.js';
import { MonetizationService } from './monetization.service.js';

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
    case 'accounts':
      print(await db.query('SELECT id, installation_id, account_name, phone_number, balance FROM accounts ORDER BY created_at'));
      break;
    default:
      console.log('Commands: pricing:show | pricing:set <json> | tokens:grant <accountId> <PROMOTIONAL|ADMIN> <qty> <reference> [expiresAt] | tokens:expire | wallet:show <accountId> | wallet:reconcile <accountId> | devices | device:lost <installationId> <reason> | settings:show | settings:set <key> <value> | accounts');
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.close();
}
