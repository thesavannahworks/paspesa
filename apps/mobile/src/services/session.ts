/**
 * Signing in to the app with an email code (required once per device when a server is configured), and
 * signing out. After sign-in the Paspesa PIN is used as before.
 *
 * One active device per account: signing in elsewhere moves the account there. This device then uploads
 * what it recorded before the move and wipes itself (the account stays on the server).
 */
import {
  normalizeState,
  stateFromSnapshot,
  type AccountSnapshot,
  type EngineDeps,
  type MemoryState,
  type SignInResult,
  type SignInStatus,
} from '@paspesa/core';
import { useSyncExternalStore } from 'react';
import { ApiError, type PaspesaApi } from './api';
import type { KeyValueStore } from './kvTypes';

const EMAIL_KEY = 'auth.email';

export interface SessionState {
  /** A server is configured, so signing in is required. */
  required: boolean;
  /** The signed-in email on this device. */
  email: string | null;
  /** Shown on the sign-in screen (e.g. "you signed in on another device"). */
  notice: string | null;
}

interface SessionDeps {
  kv: KeyValueStore;
  api: PaspesaApi;
  deps: EngineDeps;
  /** Replaces the whole local ledger durably (empty = wipe). */
  replaceLedger(state: MemoryState): Promise<void>;
  /** Uploads what is waiting, now. */
  syncNow(options?: { uploadOnly?: boolean }): Promise<void>;
}

let ctx: SessionDeps | null = null;
let state: SessionState = { required: false, email: null, notice: null };
const listeners = new Set<() => void>();
const wipeListeners = new Set<() => void>();

const publish = (patch: Partial<SessionState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export async function initSession(d: SessionDeps) {
  ctx = d;
  state = { required: d.api.available, email: await d.kv.get(EMAIL_KEY), notice: null };
}

export const sessionState = () => state;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, sessionState, sessionState);
}

/** Screens clear per-person preferences (profile photo, biometrics) when the device is wiped. */
export function onWiped(listener: () => void): () => void {
  wipeListeners.add(listener);
  return () => { wipeListeners.delete(listener); };
}

const need = () => {
  if (!ctx) throw new Error('Session not ready');
  return ctx;
};

export const messageOf = (e: unknown) =>
  e instanceof ApiError ? (e.status === 0 ? 'No connection to Paspesa. Check your internet and try again.' : e.message) : e instanceof Error ? e.message : String(e);

export async function requestCode(email: string): Promise<{ resendAfterSeconds: number }> {
  return need().api.post('/v1/auth/code', { email });
}

export type VerifyOutcome =
  | { kind: 'DONE'; result: SignInResult }
  /** The email has an account and this device has a different one: the user chooses. */
  | { kind: 'CONFLICT'; message: string };

/**
 * Checks the code. On success: binds this device; restores the email's account if this device has none.
 * `replaceLocal`: the user chose to drop this device's own account for the email's.
 */
export async function verifyCode(email: string, code: string, replaceLocal = false): Promise<VerifyOutcome> {
  const c = need();
  let result: SignInResult;
  try {
    result = await c.api.post<SignInResult>('/v1/auth/verify', { email, code, replaceLocalAccount: replaceLocal });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'ACCOUNT_CONFLICT') return { kind: 'CONFLICT', message: e.message };
    throw e;
  }
  const local = await c.deps.store.getAccount();
  if (result.accountId && (!local || local.id !== result.accountId)) {
    const snapshot = await c.api.get<AccountSnapshot>('/v1/account/restore');
    await c.replaceLedger(stateFromSnapshot(snapshot, c.deps.installationId));
  } else if (!result.accountId && local && replaceLocal) {
    // The user chose to start fresh with this email: the other email's account leaves this device.
    await c.replaceLedger(normalizeState({}));
  }
  await c.kv.set(EMAIL_KEY, result.email);
  publish({ email: result.email, notice: null });
  return { kind: 'DONE', result };
}

/** What signing out would leave behind (simulations not uploaded yet). */
export async function pendingUploads(): Promise<number> {
  const outbox = await need().deps.store.listOutbox();
  return outbox.filter((e) => e.status === 'PENDING' || e.status === 'SYNCING').length;
}

/**
 * Signs out on this device: uploads what is waiting, returns tokens set aside here, tells the server,
 * then wipes the device. `force` signs out even if some simulations could not be uploaded (they are lost).
 */
export type SignOutStep = 'BACKING_UP' | 'SIGNING_OUT';

/** Waits for `work`, but at most `ms` (sign-out never hangs on a slow connection). */
const atMost = (work: Promise<unknown>, ms: number) => Promise.race([work.catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);

export async function signOut(force = false, onStep: (step: SignOutStep) => void = () => undefined): Promise<{ ok: true } | { ok: false; waiting: number }> {
  const c = need();
  if (!force && (await pendingUploads())) {
    onStep('BACKING_UP');
    // Only the upload (no settings or review checks), and not for ever.
    await atMost(c.syncNow({ uploadOnly: true }), 10_000);
    const waiting = await pendingUploads();
    if (waiting) return { ok: false, waiting };
  }
  onStep('SIGNING_OUT');
  await wipe(null, () => atMost(c.api.post('/v1/auth/sign-out'), 5_000));
  return { ok: true };
}

/**
 * This device and the backup disagree (something it recorded was dismissed in review): replace the
 * device's ledger with the backup, keeping its PIN and tokens set aside. Things not uploaded are lost.
 */
export async function reloadFromBackup(): Promise<void> {
  const c = need();
  const account = await c.deps.store.getAccount();
  const snapshot = await c.api.get<AccountSnapshot>('/v1/account/restore');
  await c.replaceLedger(stateFromSnapshot(snapshot, c.deps.installationId, account ? { pin: account.pin, tokenAllocation: account.tokenAllocation ?? null } : null));
}

let handlingElsewhere = false;

/** After every sync: has another device taken over this account? Wipe once everything is uploaded. */
export async function checkSignedInElsewhere(pushSaidSignedOut = false): Promise<void> {
  const c = ctx;
  if (!c || !state.email || handlingElsewhere) return;
  let elsewhere = pushSaidSignedOut;
  if (!elsewhere) {
    const me = await c.api.get<SignInStatus>('/v1/auth/me').catch(() => null);
    elsewhere = !!me?.signedOutElsewhere;
  }
  if (!elsewhere) return;
  if (await pendingUploads()) return; // the next sync uploads the rest first
  handlingElsewhere = true;
  try {
    await wipe('You signed in on another device, so you were signed out here. Your account and history are safe — sign in again to use this device.');
  } finally {
    handlingElsewhere = false;
  }
}

async function wipe(notice: string | null, alsoTell: () => Promise<unknown> = async () => undefined) {
  const c = need();
  const account = await c.deps.store.getAccount();
  // Tokens set aside here go back to the balance (everything spent here is uploaded by now), and the
  // server hears about the sign-out — both at once, each with a short limit.
  await Promise.all([
    account?.tokenAllocation ? atMost(c.api.post('/v1/allocations/release', { deviceRemaining: account.tokenAllocation.remaining }), 5_000) : null,
    alsoTell(),
  ]);
  await c.replaceLedger(normalizeState({}));
  await c.kv.remove(EMAIL_KEY);
  for (const l of wipeListeners) l();
  publish({ email: null, notice });
}
