/**
 * Clearing unused device records: only records nothing depends on, idle long enough, are removed,
 * and a removed installation can register again with the same secret.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';
import { countUnusedDevices, removeUnusedDevices } from '../src/devices.js';

let db: Database;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  db = await openDatabase({});
  app = await createApp(db);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const add = (id: string, lastSeenDaysAgo: number, extra = '') =>
  db.query(`INSERT INTO installations (id, token_hash, platform, last_seen_at${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ($1, 'h-' || $1, 'web', $2${extra ? ", '" + extra.split('=')[1] + "'" : ''})`, [id, ago(lastSeenDaysAgo)]);
const exists = async (id: string) => (await db.query('SELECT 1 FROM installations WHERE id = $1', [id])).length === 1;

describe('unused devices', () => {
  it('removes only idle records that nothing depends on', async () => {
    await add('dev-idle-old', 40);
    await add('dev-idle-new', 3);
    await add('dev-just-now', 0);
    await add('dev-suspended', 40, `suspended_at=${ago(41)}`);
    await add('dev-lost', 40, 'status=LOST');
    await add('dev-uploaded', 40);
    await db.query("INSERT INTO sync_operations (installation_id, operation_id, entity_type, operation_type, fingerprint, status, code) VALUES ('dev-uploaded', 'op1', 'TRANSACTION', 'CREATE', 'f', 'APPLIED', 'OK')");
    await add('dev-signed-in', 40);
    await db.query("INSERT INTO users (id, email) VALUES ('u-dev', 'device-test@example.com')");
    await db.query("UPDATE installations SET user_id = 'u-dev' WHERE id = 'dev-signed-in'");
    await add('dev-with-code', 40);
    await db.query("INSERT INTO sign_in_codes (email, installation_id, code_hash, expires_at) VALUES ('x@example.com', 'dev-with-code', 'c', $1)", [ago(40)]);

    expect(await countUnusedDevices(db, 30)).toBe(2);
    expect(await removeUnusedDevices(db, 30)).toBe(2);
    expect(await exists('dev-idle-old')).toBe(false);
    expect(await exists('dev-with-code')).toBe(false);
    for (const kept of ['dev-idle-new', 'dev-just-now', 'dev-suspended', 'dev-lost', 'dev-uploaded', 'dev-signed-in']) {
      expect(await exists(kept)).toBe(true);
    }
    // "0 days" still spares a record seen in the last few minutes
    expect(await removeUnusedDevices(db, 0)).toBe(1);
    expect(await exists('dev-idle-new')).toBe(false);
    expect(await exists('dev-just-now')).toBe(true);
  });

  it('tells a removed installation it is unknown, and lets it register again', async () => {
    const id = 'dev-comes-back-1';
    const token = 'a'.repeat(64);
    const register = () => fetch(`${base}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: id, token, platform: 'web' }) });
    expect((await register()).status).toBe(200);
    await db.query('UPDATE installations SET last_seen_at = $2 WHERE id = $1', [id, ago(60)]);
    await removeUnusedDevices(db, 30);
    const res = await fetch(`${base}/v1/pricing`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNKNOWN_INSTALLATION');
    expect((await register()).status).toBe(200);
    expect((await fetch(`${base}/v1/pricing`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });
});
