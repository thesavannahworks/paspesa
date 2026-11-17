/**
 * Starts the Paspesa backend.
 *
 * Environment:
 *   PORT          default 3000
 *   HOST          default 0.0.0.0 (reachable from a phone on the same Wi-Fi)
 *   DATABASE_URL  postgres://… — a PostgreSQL server. When not set, the embedded PostgreSQL (PGlite)
 *                 is used with its data in PGLITE_DIR (default ./.data/pglite).
 *   MPESA_*       M-PESA STK Push (Daraja) credentials — see src/mpesa.ts. Without them payments are off.
 */
import { openDatabase } from './database.js';
import { createApp } from './app.js';

// Settings and secrets (DATABASE_URL, MPESA_*) from apps/backend/.env when present (git-ignored).
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file: use the environment as is
}
import { MonetizationService } from './monetization.service.js';
import { DarajaProvider, darajaConfigFromEnv } from './mpesa.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL || undefined;
const pgliteDir = process.env.PGLITE_DIR ?? './.data/pglite';

const db = await openDatabase(databaseUrl ? { databaseUrl } : { pgliteDir });
const mpesa = darajaConfigFromEnv(process.env);
const paymentProvider = mpesa ? new DarajaProvider(mpesa) : null;
const app = await createApp(db, { paymentProvider });
app.enableShutdownHooks();
await app.listen(port, host);
if (paymentProvider) {
  // Confirm payments still waiting on M-PESA (callbacks only speed this up).
  const money = new MonetizationService(db);
  setInterval(() => void money.verifyPendingPayments(paymentProvider).catch((e) => console.warn('[paspesa] payment check failed', e)), 20_000);
}
console.log(`[paspesa] payments: ${mpesa ? `M-PESA STK Push (${mpesa.environment})` : 'not configured'}`);
console.log(`[paspesa] backend listening on http://${host}:${port} (database: ${db.kind === 'postgres' ? 'PostgreSQL' : `embedded PostgreSQL in ${pgliteDir}`})`);

const stop = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
