/**
 * Background synchronization with the Paspesa backend (White Paper §24). Optional: it runs only when
 * EXPO_PUBLIC_PASPESA_API_URL is set (e.g. http://192.168.1.10:3000 while developing). Without it the
 * app works fully offline, exactly as before.
 *
 * Uploads the outbox on start, shortly after every new local change, when the app comes back to the
 * foreground, and every minute. Failures leave everything queued; the next attempt simply retries
 * (the server de-duplicates by operation ID).
 */
import { outboxSummary, syncOutbox, type EngineDeps, type SyncPushRequest, type SyncPushResponse, type SyncReport, type SyncTransport } from '@paspesa/core';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { apiUrl, refreshServerConfig, request, ensureToken, type PaspesaApi } from './api';
import { checkSignedInElsewhere } from './session';
import type { KeyValueStore } from './kvTypes';

const INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 1_500;
/** Back-office settings (payment switch, pricing) are re-read this often while the app is open. */
const CONFIG_POLL_MS = 15_000;
/** Longest the Send/Pay button waits for the server's latest settings before using the ones it has. */
const CONFIG_CHECK_MS = 3_000;

export interface SyncStatus {
  enabled: boolean;
  running: boolean;
  waiting: number;
  needsReview: number;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface SyncRunner {
  kick(): void;
  /** Uploads what is waiting now (after any run in progress); resolves when done. */
  syncNow(): Promise<void>;
  status(): SyncStatus;
  subscribe(listener: (s: SyncStatus) => void): () => void;
  start(): void;
}

let current: SyncRunner | null = null;

/** Ask for a sync soon (e.g. before returning tokens, which needs all spending uploaded). */
export const kickSync = () => current?.kick();

let configCheck: ((timeoutMs: number) => Promise<void>) | null = null;
/**
 * Re-reads pricing and back-office settings now (waits at most `timeoutMs`; offline it returns at once
 * with the last known settings). Journeys call it before the PIN so a change made in the back office a
 * moment ago applies to the simulation being confirmed.
 */
export const checkServerConfig = (timeoutMs = CONFIG_CHECK_MS): Promise<void> => configCheck?.(timeoutMs) ?? Promise.resolve();

/** Live sync status for screens (Profile shows it). */
export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(() => current?.status() ?? null);
  useEffect(() => current?.subscribe(setStatus), []);
  return status;
}

/** onConfigChange: pricing or back-office settings changed (screens should refresh). */
export function createSyncRunner(deps: EngineDeps, kv: KeyValueStore, api: PaspesaApi, platform: string, onConfigChange: () => void = () => undefined): SyncRunner {
  const base = apiUrl();
  const listeners = new Set<(s: SyncStatus) => void>();
  let state: SyncStatus = { enabled: !!base, running: false, waiting: 0, needsReview: 0, lastError: null, lastSyncedAt: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let again = false;
  let started = false;

  const publish = (patch: Partial<SyncStatus>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  };

  const checkConfig = async (timeoutMs: number) => {
    if (!base) return;
    // The fetch keeps going after a timeout and still applies what it gets.
    const fetched = refreshServerConfig(api, deps, kv).then((changed) => { if (changed) onConfigChange(); }, () => undefined);
    await Promise.race([fetched, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  };
  configCheck = checkConfig;

  const refreshCounts = async () => {
    const s = await outboxSummary(deps.store);
    publish({ waiting: s.waiting, needsReview: s.needsReview });
  };

  const run = async () => {
    if (!base) return;
    if (state.running) {
      again = true;
      return;
    }
    publish({ running: true });
    try {
      const token = await ensureToken(kv, base, deps.installationId, platform);
      // Back-office pricing and settings (payment switch, offline rules) follow every sync.
      if (await refreshServerConfig(api, deps, kv).catch(() => false)) onConfigChange();
      let signedOut = false;
      const transport: SyncTransport = {
        push: async (body: SyncPushRequest) => {
          const res = await request<SyncPushResponse>(`${base}/v1/sync/push`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
          if (res.signedOut) signedOut = true;
          return res;
        },
      };
      const report: SyncReport = await syncOutbox(deps, transport);
      publish({ lastError: report.error, ...(report.error ? {} : { lastSyncedAt: new Date().toISOString() }) });
      // Signed in on another device? This one wipes itself once everything above is uploaded.
      if (!report.error) {
        await refreshCounts().catch(() => undefined);
        await checkSignedInElsewhere(signedOut).catch(() => undefined);
      }
    } catch (e) {
      publish({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      await refreshCounts().catch(() => undefined);
      publish({ running: false });
      if (again) {
        again = false;
        kick();
      }
    }
  };

  function kick() {
    // A new change is waiting: show it straight away (not "up to date") until the upload finishes.
    void refreshCounts().catch(() => undefined);
    if (!base) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, DEBOUNCE_MS);
  }

  const runner: SyncRunner = {
    kick,
    async syncNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      while (state.running) await new Promise((r) => setTimeout(r, 200));
      await run();
    },
    status: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      void refreshCounts();
      if (!base) return;
      kick();
      setInterval(() => void run(), INTERVAL_MS);
      setInterval(() => {
        if (AppState.currentState === 'active') void checkConfig(10_000);
      }, CONFIG_POLL_MS);
      AppState.addEventListener('change', (s) => {
        if (s === 'active') kick();
      });
    },
  };
  current = runner;
  return runner;
}
