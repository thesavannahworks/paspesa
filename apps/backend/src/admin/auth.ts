/**
 * Back-office authentication and permissions (White Paper §35.9, §44.3).
 *
 *  - Passwords: scrypt with a per-user salt; compared in constant time.
 *  - Login lock: 5 failed attempts lock the account for 15 minutes.
 *  - Sessions: random token in an HttpOnly, SameSite=Strict cookie; only its SHA-256 is stored; 8 hours.
 *  - CSRF: every session has its own token, required on every form submission.
 *  - 2-step sign-in (optional per admin): an authenticator-app code after the password, or a one-time
 *    recovery code. The password step leaves only a 5-minute pending token (HttpOnly cookie, 5 tries).
 *  - Roles: VIEWER (read), OPERATOR (+ day-to-day operations), ADMIN (+ pricing, settings, admin users).
 *    Enforced on the server for every action, not only by hiding buttons.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from '../database.js';
import { newRecoveryCodes, newTotpSecret, verifyTotp } from './totp.js';

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
export const PENDING_COOKIE = 'paspesa_admin_2fa';
const PENDING_MINUTES = 5;
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

  /**
   * Password step. Returns a session token — or, with 2-step sign-in on, a pending token for the code
   * step — or a reason. Locks the account after repeated failures.
   */
  async login(emailRaw: string, password: string, userAgent = ''): Promise<{ ok: true; token: string } | { ok: true; pending: string } | { ok: false; message: string }> {
    const email = emailRaw.trim().toLowerCase();
    const [u] = await this.db.query<{ id: string; password_hash: string; status: string; failed_attempts: number; locked_until: Date | null; totp_enabled_at: Date | null }>(
      'SELECT id, password_hash, status, failed_attempts, locked_until, totp_enabled_at FROM admin_users WHERE email = $1',
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
    await this.db.query('UPDATE admin_users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [u.id]);
    if (u.totp_enabled_at) {
      const pending = randomBytes(32).toString('hex');
      await this.db.query('INSERT INTO admin_pending_logins (token_hash, admin_id, expires_at) VALUES ($1, $2, $3)', [
        sha256(pending), u.id, new Date(Date.now() + PENDING_MINUTES * 60_000).toISOString(),
      ]);
      return { ok: true, pending };
    }
    return { ok: true, token: await this.createSession(u.id, userAgent) };
  }

  private async createSession(adminId: string, userAgent: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.db.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [adminId]);
    await this.db.query('INSERT INTO admin_sessions (token_hash, admin_id, csrf, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5)', [
      sha256(token), adminId, randomBytes(24).toString('hex'), new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString(), userAgent.slice(0, 200),
    ]);
    return token;
  }

  /** Code step: an authenticator code, or one of the recovery codes (each works once). */
  async completeLogin(pending: string | undefined, codeRaw: string, userAgent = ''): Promise<{ ok: true; token: string } | { ok: false; message: string; restart?: boolean }> {
    if (!pending || !/^[0-9a-f]{64}$/.test(pending)) return { ok: false, message: 'Sign in again', restart: true };
    const [p] = await this.db.query<{ admin_id: string; attempts: number; expires_at: Date }>(
      'SELECT admin_id, attempts, expires_at FROM admin_pending_logins WHERE token_hash = $1', [sha256(pending)],
    );
    if (!p || new Date(p.expires_at).getTime() <= Date.now() || p.attempts >= MAX_FAILED) {
      await this.db.query('DELETE FROM admin_pending_logins WHERE token_hash = $1', [sha256(pending)]);
      return { ok: false, message: 'That took too long or had too many tries. Sign in again.', restart: true };
    }
    const [u] = await this.db.query<{ totp_secret: string | null; totp_last_step: string | null; recovery_codes: string[]; status: string }>(
      'SELECT totp_secret, totp_last_step, recovery_codes, status FROM admin_users WHERE id = $1', [p.admin_id],
    );
    const code = (codeRaw ?? '').trim().toLowerCase();
    let ok = false;
    if (u && u.status === 'ACTIVE' && u.totp_secret) {
      const step = verifyTotp(u.totp_secret, code, Date.now(), u.totp_last_step === null ? null : Number(u.totp_last_step));
      if (step !== null) {
        ok = true;
        await this.db.query('UPDATE admin_users SET totp_last_step = $2 WHERE id = $1', [p.admin_id, step]);
      } else if (/^[a-z0-9]{4}-?[a-z0-9]{4}$/.test(code)) {
        const plain = code.includes('-') ? code : `${code.slice(0, 4)}-${code.slice(4)}`;
        const h = sha256(plain);
        if (u.recovery_codes.includes(h)) {
          ok = true;
          await this.db.query('UPDATE admin_users SET recovery_codes = $2 WHERE id = $1', [p.admin_id, JSON.stringify(u.recovery_codes.filter((c) => c !== h))]);
          await this.audit(`admin:${p.admin_id}`, 'USED_RECOVERY_CODE', p.admin_id);
        }
      }
    }
    if (!ok) {
      await this.db.query('UPDATE admin_pending_logins SET attempts = attempts + 1 WHERE token_hash = $1', [sha256(pending)]);
      return { ok: false, message: 'Wrong code. Use the 6 digits your authenticator app shows now, or a recovery code.' };
    }
    await this.db.query('DELETE FROM admin_pending_logins WHERE token_hash = $1', [sha256(pending)]);
    return { ok: true, token: await this.createSession(p.admin_id, userAgent) };
  }

  private audit(actor: string, action: string, adminId: string, reason: string | null = null) {
    return this.db.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, reason) VALUES ($1, $2, $3, $4, $5)', [actor, action, 'ADMIN_USER', adminId, reason]);
  }

  // ---------------------------------------------------------------- my account

  async profile(adminId: string) {
    const [u] = await this.db.query<{ email: string; name: string; role: AdminRole; created_at: Date; last_login_at: Date | null; password_changed_at: Date | null; totp_enabled_at: Date | null; totp_pending_secret: string | null; recovery_codes: string[] }>(
      'SELECT email, name, role, created_at, last_login_at, password_changed_at, totp_enabled_at, totp_pending_secret, recovery_codes FROM admin_users WHERE id = $1', [adminId],
    );
    return u ? { ...u, recoveryCodesLeft: u.recovery_codes.length } : null;
  }

  async rename(adminId: string, name: string, actor: string) {
    const clean = name.trim().slice(0, 80);
    if (!clean) throw new Error('Enter your name');
    await this.db.query('UPDATE admin_users SET name = $2 WHERE id = $1', [adminId, clean]);
    await this.audit(actor, 'RENAME_ADMIN', adminId);
  }

  /** Needs the current password; signs out every other session. */
  async changePassword(adminId: string, current: string, next: string, keepSessionToken: string | undefined, actor: string) {
    const [u] = await this.db.query<{ password_hash: string }>('SELECT password_hash FROM admin_users WHERE id = $1', [adminId]);
    if (!u || !(await verifyPassword(current, u.password_hash))) throw new Error('Your current password is wrong');
    const problem = passwordProblem(next);
    if (problem) throw new Error(problem);
    if (current === next) throw new Error('Choose a password different from the current one');
    await this.db.query('UPDATE admin_users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [adminId, await hashPassword(next)]);
    await this.db.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2', [adminId, sha256(keepSessionToken ?? '')]);
    await this.audit(actor, 'CHANGE_PASSWORD', adminId);
  }

  /** Step 1 of turning on 2-step sign-in: a new secret to scan (not active until a code confirms it). */
  async startTotp(adminId: string): Promise<string> {
    const secret = newTotpSecret();
    await this.db.query('UPDATE admin_users SET totp_pending_secret = $2 WHERE id = $1', [adminId, secret]);
    return secret;
  }

  /** Step 2: a code from the app proves it was set up; returns recovery codes (shown once). */
  async confirmTotp(adminId: string, code: string, actor: string): Promise<string[]> {
    const [u] = await this.db.query<{ totp_pending_secret: string | null }>('SELECT totp_pending_secret FROM admin_users WHERE id = $1', [adminId]);
    if (!u?.totp_pending_secret) throw new Error('Start the set-up again');
    const step = verifyTotp(u.totp_pending_secret, code);
    if (step === null) throw new Error('That code did not match. Check the time on your phone and try the next code.');
    const codes = newRecoveryCodes();
    await this.db.query(
      'UPDATE admin_users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = now(), totp_last_step = $2, recovery_codes = $3 WHERE id = $1',
      [adminId, step, JSON.stringify(codes.map(sha256))],
    );
    await this.audit(actor, 'ENABLE_2FA', adminId);
    return codes;
  }

  /** Turning it off needs the password. */
  async disableTotp(adminId: string, password: string, actor: string) {
    const [u] = await this.db.query<{ password_hash: string }>('SELECT password_hash FROM admin_users WHERE id = $1', [adminId]);
    if (!u || !(await verifyPassword(password, u.password_hash))) throw new Error('Your password is wrong');
    await this.clearTotp(adminId);
    await this.audit(actor, 'DISABLE_2FA', adminId);
  }

  /** New recovery codes (the old ones stop working); needs the password. */
  async regenerateRecoveryCodes(adminId: string, password: string, actor: string): Promise<string[]> {
    const [u] = await this.db.query<{ password_hash: string; totp_enabled_at: Date | null }>('SELECT password_hash, totp_enabled_at FROM admin_users WHERE id = $1', [adminId]);
    if (!u || !(await verifyPassword(password, u.password_hash))) throw new Error('Your password is wrong');
    if (!u.totp_enabled_at) throw new Error('Turn on 2-step sign-in first');
    const codes = newRecoveryCodes();
    await this.db.query('UPDATE admin_users SET recovery_codes = $2 WHERE id = $1', [adminId, JSON.stringify(codes.map(sha256))]);
    await this.audit(actor, 'NEW_RECOVERY_CODES', adminId);
    return codes;
  }

  /** An administrator resets someone's 2-step sign-in (lost phone and recovery codes). */
  async resetTotp(adminId: string, actor: string) {
    await this.clearTotp(adminId);
    await this.db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [adminId]);
    await this.audit(actor, 'RESET_2FA', adminId);
  }

  private clearTotp(adminId: string) {
    return this.db.query("UPDATE admin_users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = '[]' WHERE id = $1", [adminId]);
  }

  async sessions(adminId: string) {
    return this.db.query<{ token_hash: string; created_at: Date; expires_at: Date; user_agent: string | null }>(
      'SELECT token_hash, created_at, expires_at, user_agent FROM admin_sessions WHERE admin_id = $1 AND expires_at > now() ORDER BY created_at DESC', [adminId],
    );
  }

  async signOutOthers(adminId: string, keepSessionToken: string | undefined, actor: string): Promise<number> {
    const removed = await this.db.query<{ token_hash: string }>('DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2 RETURNING token_hash', [adminId, sha256(keepSessionToken ?? '')]);
    await this.audit(actor, 'SIGN_OUT_OTHER_SESSIONS', adminId);
    return removed.length;
  }

  /** Whether a session row is the one making the request (the sessions list marks it). */
  isCurrent(tokenHash: string, token: string | undefined) {
    return tokenHash === sha256(token ?? '');
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

export const pendingCookie = (token: string, secure: boolean) =>
  `${PENDING_COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${PENDING_MINUTES * 60}${secure ? '; Secure' : ''}`;
export const clearPendingCookie = () => `${PENDING_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`;
