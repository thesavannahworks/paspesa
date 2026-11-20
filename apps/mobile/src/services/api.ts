/**
 * Paspesa backend API client. Optional: available only when EXPO_PUBLIC_PASPESA_API_URL is set.
 * The installation registers once with a secret created on this device (only its hash is kept by the server).
 *
 * Also keeps the engine's pricing and monetization settings in step with the back office: they are fetched
 * on every sync, cached for offline use, and applied to `deps.config`.
 */
import type { EngineDeps, FeeSchedule, MonetizationSettings, PricingConfiguration } from '@paspesa/core';
import * as Crypto from 'expo-crypto';
import type { KeyValueStore } from './kvTypes';

const TOKEN_KEY = 'sync.token';
const REGISTERED_KEY = 'sync.registered';
const SERVER_CONFIG_KEY = 'server.config';
const TIMEOUT_MS = 20_000;

export const apiUrl = (): string | null => {
  const url = process.env.EXPO_PUBLIC_PASPESA_API_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
};

export class ApiError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
  }
}

/** A back-office suspension of this device or of its account (see the server's suspension.ts). */
export type Suspension = { kind: 'DEVICE' | 'ACCOUNT'; message: string };
/** What the server's answers say about suspension: blocked, or a request went through. */
export type SuspensionSignal = Suspension | { kind: 'OK'; authPath: boolean };
let suspensionListener: (signal: SuspensionSignal) => void = () => undefined;
export const setSuspensionListener = (listener: (signal: SuspensionSignal) => void) => { suspensionListener = listener; };

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const path = pathOf(url);
  const authPath = path.startsWith('/v1/auth/');
  const authed = !!(init.headers as Record<string, string> | undefined)?.authorization;
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = body?.error?.code ?? null;
      const message = body?.error?.message ?? `Server error ${res.status}`;
      // An account suspension on /v1/auth/* is about the email typed in, not this device.
      if (code === 'DEVICE_SUSPENDED') suspensionListener({ kind: 'DEVICE', message });
      else if (code === 'ACCOUNT_SUSPENDED' && !authPath) suspensionListener({ kind: 'ACCOUNT', message });
      throw new ApiError(message, code, res.status);
    }
    if (authed) suspensionListener({ kind: 'OK', authPath });
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new ApiError('The server did not respond in time', 'TIMEOUT', 0);
    if (e instanceof ApiError) throw e;
    throw new ApiError('Could not reach the Paspesa server. Check your internet connection.', 'OFFLINE', 0);
  } finally {
    clearTimeout(timer);
  }
}

/** The installation's secret: created on this device; registered once per server. */
export async function ensureToken(kv: KeyValueStore, base: string, installationId: string, platform: string): Promise<string> {
  let token = await kv.get(TOKEN_KEY);
  if (!token) {
    const bytes = new Uint8Array(32);
    Crypto.getRandomValues(bytes);
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await kv.set(TOKEN_KEY, token);
  }
  if ((await kv.get(REGISTERED_KEY)) !== base) {
    await request(`${base}/v1/installations`, { method: 'POST', body: JSON.stringify({ installationId, token, platform }) });
    await kv.set(REGISTERED_KEY, base);
  }
  return token;
}

export interface PaspesaApi {
  /** False when no server is configured: screens explain that online features are unavailable. */
  readonly available: boolean;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

let current: PaspesaApi = { available: false, get: () => Promise.reject(new ApiError('Not ready', 'NOT_CONFIGURED', 0)), post: () => Promise.reject(new ApiError('Not ready', 'NOT_CONFIGURED', 0)) };

/** The app's API client (screens). */
export const useApi = (): PaspesaApi => current;

export function createApi(deps: EngineDeps, kv: KeyValueStore, platform: string): PaspesaApi {
  const base = apiUrl();
  const call = async <T>(path: string, init: RequestInit): Promise<T> => {
    if (!base) throw new ApiError('Online features are not set up in this version of the app.', 'NOT_CONFIGURED', 0);
    const token = await ensureToken(kv, base, deps.installationId, platform);
    return request<T>(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  };
  current = {
    available: !!base,
    get: (path) => call(path, {}),
    post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  };
  return current;
}

type ServerConfig = PricingConfiguration & { settings: MonetizationSettings; feeSchedules?: FeeSchedule[] };

const apply = (deps: EngineDeps, cfg: ServerConfig) => {
  const { settings, feeSchedules, ...pricing } = cfg;
  deps.config = {
    ...deps.config,
    pricing,
    monetization: { ...deps.config.monetization, ...settings },
    // Fee schedules edited in the back office (older servers send none: keep the built-in ones).
    ...(feeSchedules?.length ? { feeSchedules } : {}),
  };
};

/** Applies the last pricing/settings received from the server (offline start-up). */
export async function loadCachedServerConfig(deps: EngineDeps, kv: KeyValueStore) {
  const raw = await kv.get(SERVER_CONFIG_KEY);
  if (raw) apply(deps, JSON.parse(raw) as ServerConfig);
}

/** Fetches pricing and back-office settings; returns true when something changed. */
export async function refreshServerConfig(api: PaspesaApi, deps: EngineDeps, kv: KeyValueStore): Promise<boolean> {
  const cfg = await api.get<ServerConfig>('/v1/pricing');
  const raw = JSON.stringify(cfg);
  if (raw === (await kv.get(SERVER_CONFIG_KEY))) return false;
  await kv.set(SERVER_CONFIG_KEY, raw);
  apply(deps, cfg);
  return true;
}
