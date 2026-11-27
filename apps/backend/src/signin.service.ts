/**
 * Account sign-in by email and one-time code, one active device per account, and account restore.
 *
 *  - Codes: 6 digits, 10 minutes, 5 tries; only a salted SHA-256 is stored. At most one code a minute
 *    and 10 a day per email (20 a day per device). The answer never says whether an email has an account.
 *  - Signing in on a device binds it to the person; if their account is active on another device, the
 *    account moves here and the other device is marked signed out (it may still upload what it recorded
 *    before that moment, then wipes itself).
 *  - The simulated PIN is never sent to the server.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { emailSuspended } from './suspension.js';
import { isValidEmail, normalizeEmail, type AccountSnapshot, type Favourite, type SignInResult, type SignInStatus, type SyncMessage, type SyncTransaction } from '@paspesa/core';
import type { Database, Queryable } from './database.js';
import type { Mailer } from './mailer.js';

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const RESEND_SECONDS = 60;
const PER_EMAIL_PER_DAY = 10;
const PER_DEVICE_PER_DAY = 20;

/** What a one-time code is for: a sign-in code can never confirm a deletion, or the reverse. */
export type CodePurpose = 'SIGN_IN' | 'DELETE_ACCOUNT';

/** Hides most of an email for display: "jo***@example.com". */
export const maskEmail = (email: string) => {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(3, user.length - 2)))}@${domain}`;
};

export class SignInError extends Error {
  constructor(readonly code: 'VALIDATION' | 'WRONG_CODE' | 'CODE_EXPIRED' | 'TOO_MANY' | 'ACCOUNT_CONFLICT' | 'NOT_SIGNED_IN' | 'NOT_ACTIVE_DEVICE' | 'ACCOUNT_SUSPENDED', message: string) {
    super(message);
  }
}

const codeHash = (salt: string, email: string, code: string) => `${salt}$${createHash('sha256').update(`${salt}:${email}:${code}`).digest('hex')}`;

function codeMatches(stored: string, email: string, code: string): boolean {
  const [salt] = stored.split('$');
  const a = Buffer.from(codeHash(salt!, email, code));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class SignInService {
  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Sends a sign-in code. Always answers the same way (no hint whether the email has an account). */
  async requestCode(emailRaw: string, installationId: string): Promise<{ sent: true; resendAfterSeconds: number }> {
    const email = normalizeEmail(emailRaw ?? '');
    if (!isValidEmail(email)) throw new SignInError('VALIDATION', 'Enter a valid email address');
    const suspended = await emailSuspended(this.db, email);
    if (suspended) throw new SignInError('ACCOUNT_SUSPENDED', suspended);
    return this.issueCode(email, installationId, 'SIGN_IN');
  }

  /**
   * Sends a code to the email of the account active on this device, to confirm deleting it (the app also
   * asks for the PIN first, but the PIN never reaches the server: the code proves it is the account holder).
   */
  async requestDeletionCode(installationId: string): Promise<{ sent: true; resendAfterSeconds: number; email: string }> {
    const email = await this.activeEmail(installationId);
    const sent = await this.issueCode(email, installationId, 'DELETE_ACCOUNT');
    return { ...sent, email: maskEmail(email) };
  }

  /** Checks a deletion code (a wrong try is counted and kept). Returns the account to delete. */
  async confirmDeletionCode(installationId: string, code: string): Promise<{ accountId: string; email: string }> {
    const email = await this.activeEmail(installationId);
    const given = String(code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(given)) throw new SignInError('VALIDATION', 'Enter the 6-digit code from the email');
    const outcome = await this.db.transaction((q) => this.takeCode(q, email, installationId, 'DELETE_ACCOUNT', given, this.now()));
    if (outcome) throw outcome;
    const [a] = await this.db.query<{ id: string }>('SELECT id FROM accounts WHERE installation_id = $1 AND deleted_at IS NULL', [installationId]);
    if (!a) throw new SignInError('NOT_SIGNED_IN', 'This device has no account to delete');
    return { accountId: a.id, email };
  }

  /** The email of the account active on this device. */
  private async activeEmail(installationId: string): Promise<string> {
    const [row] = await this.db.query<{ email: string }>(
      'SELECT u.email FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.installation_id = $1 AND a.deleted_at IS NULL',
      [installationId],
    );
    if (!row) throw new SignInError('NOT_SIGNED_IN', 'Sign in on this device first');
    return row.email;
  }

  private async issueCode(email: string, installationId: string, purpose: CodePurpose): Promise<{ sent: true; resendAfterSeconds: number }> {
    const now = this.now();
    const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
    // One code a minute per purpose; the daily limits below count every code.
    const [recent] = await this.db.query<{ created_at: Date }>('SELECT created_at FROM sign_in_codes WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1', [email, purpose]);
    if (recent && now.getTime() - new Date(recent.created_at).getTime() < RESEND_SECONDS * 1000) {
      throw new SignInError('TOO_MANY', 'A code was just sent. Wait a minute before asking for another.');
    }
    const [{ n: perEmail }] = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM sign_in_codes WHERE email = $1 AND created_at > $2', [email, dayAgo]) as [{ n: string }];
    const [{ n: perDevice }] = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM sign_in_codes WHERE installation_id = $1 AND created_at > $2', [installationId, dayAgo]) as [{ n: string }];
    if (Number(perEmail) >= PER_EMAIL_PER_DAY || Number(perDevice) >= PER_DEVICE_PER_DAY) {
      throw new SignInError('TOO_MANY', 'Too many codes requested today. Try again tomorrow.');
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(12).toString('hex');
    await this.db.query('INSERT INTO sign_in_codes (email, installation_id, code_hash, created_at, expires_at, purpose) VALUES ($1, $2, $3, $4, $5, $6)', [
      email, installationId, codeHash(salt, email, code), now.toISOString(), new Date(now.getTime() + CODE_MINUTES * 60_000).toISOString(), purpose,
    ]);
    await this.mailer.send(purpose === 'SIGN_IN' ? {
      to: email,
      subject: `${code} is your Paspesa sign-in code`,
      text: `Your Paspesa sign-in code is ${code}\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.\n\nPaspesa is a simulator: it never asks for your real M-PESA PIN.`,
      html: `<p>Your Paspesa sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.</p><p style="color:#666">Paspesa is a simulator: it never asks for your real M-PESA PIN.</p>`,
    } : {
      to: email,
      subject: `${code} is your code to delete your Paspesa account`,
      text: `Someone asked to permanently delete the Paspesa account for this email. If it was you, enter this code in the app:\n\n${code}\n\nIt expires in ${CODE_MINUTES} minutes. If it wasn't you, ignore this email: nothing is deleted without the code.`,
      html: `<p>Someone asked to <b>permanently delete</b> the Paspesa account for this email. If it was you, enter this code in the app:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in ${CODE_MINUTES} minutes. If it wasn't you, ignore this email: nothing is deleted without the code.</p>`,
    });
    return { sent: true, resendAfterSeconds: RESEND_SECONDS };
  }

  /**
   * Takes the newest unused code of this purpose for this email on this device and marks it used when it
   * matches; a wrong try is counted. Returns the refusal instead of throwing it, so the caller's transaction
   * commits the counted try.
   */
  private async takeCode(q: Queryable, email: string, installationId: string, purpose: CodePurpose, given: string, now: Date): Promise<SignInError | null> {
    const [row] = await q.query<{ id: string; code_hash: string; attempts: number; expires_at: Date }>(
      `SELECT id, code_hash, attempts, expires_at FROM sign_in_codes
       WHERE email = $1 AND installation_id = $2 AND purpose = $3 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email, installationId, purpose],
    );
    if (!row || new Date(row.expires_at).getTime() <= now.getTime()) return new SignInError('CODE_EXPIRED', 'That code has expired. Ask for a new one.');
    if (row.attempts >= MAX_TRIES) return new SignInError('TOO_MANY', 'Too many wrong tries. Ask for a new code.');
    if (!codeMatches(row.code_hash, email, given)) {
      await q.query('UPDATE sign_in_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      const left = MAX_TRIES - row.attempts - 1;
      return new SignInError(left > 0 ? 'WRONG_CODE' : 'TOO_MANY', left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.');
    }
    await q.query('UPDATE sign_in_codes SET used_at = $2 WHERE id = $1', [row.id, now.toISOString()]);
    return null;
  }

  /**
   * Checks the code and signs this device in. `replaceLocalAccount`: this device has its own account that
   * isn't the email's — the user chose to drop it and use the email's account instead.
   */
  async verifyCode(emailRaw: string, code: string, installationId: string, replaceLocalAccount = false, termsVersion: string | null = null): Promise<SignInResult> {
    const email = normalizeEmail(emailRaw ?? '');
    const given = String(code ?? '').replace(/\s/g, '');
    if (!isValidEmail(email) || !/^\d{6}$/.test(given)) throw new SignInError('VALIDATION', 'Enter the 6-digit code from the email');
    const suspended = await emailSuspended(this.db, email);
    if (suspended) throw new SignInError('ACCOUNT_SUSPENDED', suspended);
    const now = this.now();
    // A wrong try is counted in its own committed step (an error inside the sign-in transaction would undo it).
    const outcome = await this.db.transaction(async (q): Promise<SignInResult | SignInError> => {
      const refused = await this.takeCode(q, email, installationId, 'SIGN_IN', given, now);
      if (refused) return refused; // a counted wrong try is committed
      const result = await this.bind(q, email, installationId, replaceLocalAccount, now);
      // Proof of consent (DPA s.32): which version of the Privacy Policy and Terms was accepted, and when.
      if (termsVersion) {
        await q.query('UPDATE users SET terms_version = $2, terms_accepted_at = $3 WHERE email = $1', [email, termsVersion.slice(0, 40), now.toISOString()]);
      }
      return result;
    });
    if (outcome instanceof SignInError) throw outcome;
    return outcome;
  }

  private async bind(q: Queryable, email: string, installationId: string, replaceLocal: boolean, now: Date): Promise<SignInResult> {
    await q.query('INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [randomUUID(), email]);
    const [user] = await q.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    const userId = user!.id;
    await q.query('UPDATE users SET last_sign_in_at = $2 WHERE id = $1', [userId, now.toISOString()]);
    // The account this device actually holds: only one it is still the active device of (an account that
    // moved to another device was wiped from this one).
    const [device] = await q.query<{ account_id: string | null }>(
      'SELECT a.id AS account_id FROM installations i JOIN accounts a ON a.id = i.account_id AND a.installation_id = i.id WHERE i.id = $1',
      [installationId],
    );
    await q.query('SELECT 1 FROM installations WHERE id = $1 FOR UPDATE', [installationId]);
    const [owned] = await q.query<{ id: string; installation_id: string | null }>('SELECT id, installation_id FROM accounts WHERE user_id = $1 FOR UPDATE', [userId]);
    const deviceAccount = device?.account_id ?? null;
    let moved = false;

    if (owned) {
      if (deviceAccount && deviceAccount !== owned.id) {
        if (!replaceLocal) throw new SignInError('ACCOUNT_CONFLICT', 'This email already has a Paspesa account, and this device has a different one.');
        // The device drops its own account (kept on the server, no longer used by this device).
        await q.query('UPDATE installations SET account_id = NULL WHERE id = $1', [installationId]);
      }
      if (owned.installation_id !== installationId) {
        // Move the account here; the other device is signed out from now on.
        if (owned.installation_id) await q.query('UPDATE installations SET signed_out_at = $2 WHERE id = $1', [owned.installation_id, now.toISOString()]);
        await this.freeDeviceSlot(q, installationId);
        await q.query('UPDATE accounts SET installation_id = $2 WHERE id = $1', [owned.id, installationId]);
        moved = !!owned.installation_id;
      }
      await q.query('UPDATE installations SET account_id = $2, user_id = $3, signed_in_at = $4, signed_out_at = NULL WHERE id = $1', [installationId, owned.id, userId, now.toISOString()]);
      return { email, accountId: owned.id, movedFromAnotherDevice: moved };
    }

    // The email has no account yet: this device's account (if any) becomes theirs; otherwise the next
    // account created on this device will be.
    let keep = deviceAccount;
    if (deviceAccount) {
      const [taken] = await q.query<{ user_id: string | null }>('SELECT user_id FROM accounts WHERE id = $1', [deviceAccount]);
      if (taken?.user_id && taken.user_id !== userId) {
        if (!replaceLocal) throw new SignInError('ACCOUNT_CONFLICT', 'This device holds the account of another email. Continue to clear it from this device and start fresh with this email (that account stays saved).');
        // Dropped from this device (it stays on the server with its own email); this email starts fresh.
        await this.freeDeviceSlot(q, installationId);
        keep = null;
      } else {
        await q.query('UPDATE accounts SET user_id = $2 WHERE id = $1', [deviceAccount, userId]);
      }
    }
    await q.query('UPDATE installations SET account_id = $4, user_id = $2, signed_in_at = $3, signed_out_at = NULL WHERE id = $1', [installationId, userId, now.toISOString(), keep]);
    return { email, accountId: keep, movedFromAnotherDevice: false };
  }

  /** accounts.installation_id is unique: an account this device dropped stops having an active device. */
  private async freeDeviceSlot(q: Queryable, installationId: string) {
    await q.query('UPDATE accounts SET installation_id = NULL WHERE installation_id = $1', [installationId]);
  }

  async status(installationId: string): Promise<SignInStatus> {
    const [row] = await this.db.query<{ email: string | null; account_id: string | null; signed_out_at: Date | null; user_id: string | null }>(
      'SELECT u.email, i.account_id, i.signed_out_at, i.user_id FROM installations i LEFT JOIN users u ON u.id = i.user_id WHERE i.id = $1',
      [installationId],
    );
    if (!row?.user_id) return { signedIn: false, email: null, accountId: row?.account_id ?? null, signedOutElsewhere: false };
    const signedOutElsewhere = !!row.signed_out_at;
    return { signedIn: !signedOutElsewhere, email: row.email, accountId: row.account_id, signedOutElsewhere };
  }

  /** The device signs out (it has uploaded what it could and wipes itself). */
  /**
   * The device signs out (it has uploaded what it could and wipes itself): it lets go of its account, so
   * any email can sign in on it next. The account keeps everything and waits for its next sign-in.
   */
  async signOut(installationId: string): Promise<void> {
    await this.db.transaction(async (q) => {
      await q.query('UPDATE accounts SET installation_id = NULL WHERE installation_id = $1', [installationId]);
      await q.query('UPDATE installations SET account_id = NULL, user_id = NULL, signed_out_at = coalesce(signed_out_at, now()) WHERE id = $1', [installationId]);
    });
  }

  /** Everything the active device needs to continue the account. */
  async snapshot(installationId: string): Promise<AccountSnapshot> {
    const [a] = await this.db.query<Record<string, unknown>>(
      `SELECT a.* FROM accounts a JOIN installations i ON i.account_id = a.id
       WHERE i.id = $1 AND a.installation_id = $1 AND i.user_id IS NOT NULL AND i.signed_out_at IS NULL`,
      [installationId],
    );
    if (!a) throw new SignInError('NOT_ACTIVE_DEVICE', 'Sign in on this device first');
    const id = String(a.id);
    const transactions = (await this.db.query<{ record: SyncTransaction }>('SELECT record FROM transactions WHERE account_id = $1 ORDER BY sequence', [id])).map((r) => r.record);
    const messages = (await this.db.query<{ id: string; transaction_id: string; category: string; template_id: string; template_version: number; body: string; created_at: Date }>(
      'SELECT * FROM messages WHERE account_id = $1 ORDER BY created_at', [id],
    )).map((m): SyncMessage => ({
      id: m.id, transactionId: m.transaction_id, category: m.category as SyncMessage['category'], templateId: m.template_id,
      templateVersion: Number(m.template_version), body: m.body, createdAt: new Date(m.created_at).toISOString(),
    }));
    const favourites = (await this.db.query<{ record: Favourite }>('SELECT record FROM favourites WHERE account_id = $1', [id])).map((r) => r.record);
    const iso = (v: unknown) => new Date(v as string).toISOString();
    return {
      account: {
        id,
        installationId,
        accountName: String(a.account_name),
        phoneNumber: String(a.phone_number),
        openingBalance: Number(a.opening_balance),
        currency: 'KES',
        createdAt: iso(a.created_at),
        updatedAt: iso(a.updated_at),
        balance: Number(a.balance),
        airtimeBalance: Number(a.airtime_balance),
        airtimeResetTotal: Number(a.airtime_reset_total),
        rechargeSenderDefaults: (a.recharge_sender as { name: string; phone: string } | null) ?? null,
        version: Number(a.version),
      },
      transactions,
      messages,
      favourites,
    };
  }
}
