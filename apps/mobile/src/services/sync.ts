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
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { KeyValueStore } from './kvTypes';

const TOKEN_KEY = 'sync.token';
const REGISTERED_KEY = 'sync.registered';
const INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 1_500;
const TIMEOUT_MS = 20_000;

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
  status(): SyncStatus;
  subscribe(listener: (s: SyncStatus) => void): () => void;
  start(): void;
}

export const apiUrl = (): string | null => {
  const url = process.env.EXPO_PUBLIC_PASPESA_API_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
};

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new Error(body?.error?.message ?? `Server error ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('The server did not respond in time');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** The installation's secret: created on this device, only its hash is kept by the server. */
async function ensureToken(kv: KeyValueStore, base: string, installationId: string): Promise<string> {
  let token = await kv.get(TOKEN_KEY);
  if (!token) {
    const bytes = new Uint8Array(32);
    Crypto.getRandomValues(bytes);
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await kv.set(TOKEN_KEY, token);
  }
  if ((await kv.get(REGISTERED_KEY)) !== base) {
    await request(`${base}/v1/installations`, { method: 'POST', body: JSON.stringify({ installationId, token }) });
    await kv.set(REGISTERED_KEY, base);
  }
  return token;
}

let current: SyncRunner | null = null;

/** Live sync status for screens (Profile shows it). */
export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(() => current?.status() ?? null);
  useEffect(() => current?.subscribe(setStatus), []);
  return status;
}

export function createSyncRunner(deps: EngineDeps, kv: KeyValueStore): SyncRunner {
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
      const token = await ensureToken(kv, base, deps.installationId);
      const transport: SyncTransport = {
        push: (body: SyncPushRequest) => request<SyncPushResponse>(`${base}/v1/sync/push`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
      };
      const report: SyncReport = await syncOutbox(deps, transport);
      publish({ lastError: report.error, ...(report.error ? {} : { lastSyncedAt: new Date().toISOString() }) });
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
    if (!base) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, DEBOUNCE_MS);
  }

  const runner: SyncRunner = {
    kick,
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
      AppState.addEventListener('change', (s) => {
        if (s === 'active') kick();
      });
    },
  };
  current = runner;
  return runner;
}
