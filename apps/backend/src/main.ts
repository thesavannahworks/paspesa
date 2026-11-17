/**
 * Starts the Paspesa backend.
 *
 * Environment:
 *   PORT          default 3000
 *   HOST          default 0.0.0.0 (reachable from a phone on the same Wi-Fi)
 *   DATABASE_URL  postgres://… — a PostgreSQL server. When not set, the embedded PostgreSQL (PGlite)
 *                 is used with its data in PGLITE_DIR (default ./.data/pglite).
 */
import { openDatabase } from './database.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL || undefined;
const pgliteDir = process.env.PGLITE_DIR ?? './.data/pglite';

const db = await openDatabase(databaseUrl ? { databaseUrl } : { pgliteDir });
const app = await createApp(db);
app.enableShutdownHooks();
await app.listen(port, host);
console.log(`[paspesa] backend listening on http://${host}:${port} (database: ${db.kind === 'postgres' ? 'PostgreSQL' : `embedded PostgreSQL in ${pgliteDir}`})`);

const stop = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
