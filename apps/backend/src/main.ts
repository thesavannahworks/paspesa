/**
 * Starts the Paspesa backend.
 *
 * Environment:
 *   PORT          default 3000
 *   HOST          default 0.0.0.0 (reachable from a phone on the same Wi-Fi)
 *   DATABASE_URL  postgres://… — a PostgreSQL server. When not set, the embedded PostgreSQL (PGlite)
 *                 is used with its data in PGLITE_DIR (default ./.data/pglite).
 *   Payment providers (any combination; see src/providers.ts and .env.example): MPESA_* (Daraja),
 *   KOPOKOPO_*, INTASEND_*, PAYSTACK_*, PAYHERO_*; PAYMENT_PROVIDER picks the default. None → payments off.
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
import { providersFromEnv } from './providers.js';
import { mailerFromEnv } from './mailer.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL || undefined;
const pgliteDir = process.env.PGLITE_DIR ?? './.data/pglite';

const db = await openDatabase(databaseUrl ? { databaseUrl } : { pgliteDir });
const paymentProviders = providersFromEnv(process.env);
const mailer = mailerFromEnv(process.env);
const app = await createApp(db, { paymentProviders, mailer });
app.enableShutdownHooks();
await app.listen(port, host);
if (paymentProviders.all.length) {
  // Confirm payments still waiting on their provider (callbacks only speed this up).
  const money = new MonetizationService(db);
  setInterval(() => {
    for (const provider of paymentProviders.all) {
      void money.verifyPendingPayments(provider).catch((e) => console.warn(`[paspesa] ${provider.name} payment check failed`, e));
    }
  }, 20_000);
}
console.log(`[paspesa] payments: ${paymentProviders.all.length ? `${paymentProviders.all.map((p) => p.name).join(', ')} (default ${paymentProviders.default?.name})` : 'not configured'}`);
console.log(`[paspesa] sign-in emails: ${mailer.kind === 'smtp' ? `SMTP via ${process.env.SMTP_HOST}` : 'printed here (set SMTP_* in .env to send real email)'}`);
console.log(`[paspesa] backend listening on http://${host}:${port} (database: ${db.kind === 'postgres' ? 'PostgreSQL' : `embedded PostgreSQL in ${pgliteDir}`})`);

const stop = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
