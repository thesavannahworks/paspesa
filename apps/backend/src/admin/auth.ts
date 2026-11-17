/**
 * Back-office authentication and permissions (White Paper §35.9, §44.3).
 *
 *  - Passwords: scrypt with a per-user salt; compared in constant time.
 *  - Login lock: 5 failed attempts lock the account for 15 minutes.
 *  - Sessions: random token in an HttpOnly, SameSite=Strict cookie; only its SHA-256 is stored; 8 hours.
 *  - CSRF: every session has its own token, required on every form submission.
 *  - Roles: VIEWER (read), OPERATOR (+ day-to-day operations), ADMIN (+ pricing, settings, admin users).
 *    Enforced on the server for every action, not only by hiding buttons.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from '../database.js';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number }) => Promise<Buffer>;

export type AdminRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: 'ACTIVE' | 'DISABLED';
}

export interface AdminSession {
  admin: AdminUser;
  csrf: string;
}

/** What each role may do. Anything not listed is read-only (all roles may read). */
export type AdminAction =
  | 'GRANT_PROMOTIONAL'
  | 'GRANT_ADMIN_TOKENS'
  | 'VERIFY_PAYMENT'
  | 'RESOLVE_REVIEW'
  | 'MARK_DEVICE_LOST'
  | 'EDIT_PRICING'
  | 'EDIT_SETTINGS'
  | 'MANAGE_ADMINS';

const PERMISSIONS: Record<AdminRole, AdminAction[]> = {
  VIEWER: [],
  OPERATOR: ['GRANT_PROMOTIONAL', 'VERIFY_PAYMENT', 'RESOLVE_REVIEW', 'MARK_DEVICE_LOST'],
  ADMIN: ['GRANT_PROMOTIONAL', 'GRANT_ADMIN_TOKENS', 'VERIFY_PAYMENT', 'RESOLVE_REVIEW', 'MARK_DEVICE_LOST', 'EDIT_PRICING', 'EDIT_SETTINGS', 'MANAGE_ADMINS'],
};

export const can = (role: AdminRole, action: AdminAction) => PERMISSIONS[role].includes(action);

export const SESSION_COOKIE = 'paspesa_admin';
const SESSION_HOURS = 8;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const N = 16384;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !salt || !hash) return false;
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64, { N: Number(n) });
  const expected = Buffer.from(hash, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use letters and numbers';
  return null;
}

export class AdminAuth {
  constructor(private readonly db: Database) {}

  async createAdmin(input: { email: string; name: string; role: AdminRole; password: string }, actor: string): Promise<AdminUser> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address');
    const problem = passwordProblem(input.password);
    if (problem) throw new Error(problem);
    const id = randomUUID();
    await this.db.query('INSERT INTO admin_users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [
      id, email, input.name.trim().slice(0, 80) || email, await hashPassword(input.password), input.role,
    ]);
    await this.db.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after_value) VALUES ($1, $2, $3, $4, $5)', [
      actor, 'CREATE_ADMIN', 'ADMIN_USER', id, JSON.stringify({ email, role: input.role }),
    ]);
    return { id, email, name: input.name, role: input.role, status: 'ACTIVE' };
  }

  /** Returns a session token, or a reason. Locks the account after repeated failures. */
  async login(emailRaw: string, password: string): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
    const email = emailRaw.trim().toLowerCase();
    const [u] = await this.db.query<{ id: string; password_hash: string; status: string; failed_attempts: number; locked_until: Date | null }>(
      'SELECT id, password_hash, status, failed_attempts, locked_until FROM admin_users WHERE email = $1',
      [email],
    );
    const generic = { ok: false as const, message: 'Wrong email or password' };
    if (!u) {
      await hashPassword(password); // same work either way: no hint whether the email exists
      return generic;
    }
    if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) return { ok: false, message: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` };
    if (u.status !== 'ACTIVE' || !(await verifyPassword(password, u.password_hash))) {
      const failed = u.failed_attempts + 1;
      await this.db.query('UPDATE admin_users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [
        u.id, failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
      ]);
      return generic;
    }
    const token = randomBytes(32).toString('hex');
    await this.db.query('UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
    await this.db.query('INSERT INTO admin_sessions (token_hash, admin_id, csrf, expires_at) VALUES ($1, $2, $3, $4)', [
      sha256(token), u.id, randomBytes(24).toString('hex'), new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString(),
    ]);
    return { ok: true, token };
  }

  async session(token: string | undefined): Promise<AdminSession | null> {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const [row] = await this.db.query<AdminUser & { csrf: string }>(
      `SELECT u.id, u.email, u.name, u.role, u.status, s.csrf FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'ACTIVE'`,
      [sha256(token)],
    );
    if (!row) return null;
    const { csrf, ...admin } = row;
    return { admin, csrf };
  }

  async logout(token: string | undefined) {
    if (token) await this.db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(token)]);
  }

  async disable(adminId: string, actor: string) {
    await this.db.query("UPDATE admin_users SET status = 'DISABLED' WHERE id = $1", [adminId]);
    await this.db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [adminId]);
    await this.db.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)', [actor, 'DISABLE_ADMIN', 'ADMIN_USER', adminId]);
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}

export const clearCookie = () => `${SESSION_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`;
