import * as Crypto from 'expo-crypto';
import { DEFAULT_CONFIG, MemoryStore, normalizeState, stateToChangeSet, systemClock, type EngineDeps, type MemoryState } from '@paspesa/core';
import { openKeyValueStore, type KeyValueStore } from './kv';
import { openLedgerPersistence } from './ledger';
import { Platform } from 'react-native';
import { createApi, loadCachedServerConfig, type PaspesaApi } from './api';
import { createSyncRunner, type SyncRunner } from './sync';
import { initSession } from './session';

/** The old format: the whole ledger as one JSON record (migrated into the tables on first start). */
const LEGACY_STATE_KEY = 'ledger.state.v1';
const INSTALLATION_KEY = 'installation.id';
export const PREF_PREFIX = 'pref.';

export interface Runtime {
  deps: EngineDeps;
  kv: KeyValueStore;
  /** Uploads to the backend when EXPO_PUBLIC_PASPESA_API_URL is set; otherwise does nothing. */
  sync: SyncRunner;
  /** Backend API (wallet, payments, allocations); `available` is false without a server. */
  api: PaspesaApi;
  /** The app shell registers what to do when the server's pricing/settings change (refresh screens). */
  onConfigChange(listener: () => void): void;
  /** Preferences loaded at start-up (theme, balance visibility, …). Never financial data. */
  initialPrefs: Record<string, unknown>;
}

/** Every preference read at start-up. A key missing here is saved but not restored after a restart. */
// Every preference must be listed here to be loaded at start-up (one not listed resets on each launch).
const PREF_KEYS = ['theme', 'balanceHidden', 'frequentsOpen', 'profilePhoto', 'messageZoom', 'biometricsEnabled', 'tokenOrder', 'webView'];

/**
 * Builds the offline-first runtime. The ledger lives in tables (SQLite on the phone, IndexedDB in the
 * browser), is loaded once into memory at start-up, and each committed engine operation writes only the
 * rows it changed, in one database transaction, before it becomes visible.
 */
export async function createRuntime(): Promise<Runtime> {
  const kv = await openKeyValueStore();

  let installationId = await kv.get(INSTALLATION_KEY);
  if (!installationId) {
    installationId = Crypto.randomUUID();
    await kv.set(INSTALLATION_KEY, installationId);
  }

  const ledger = await openLedgerPersistence();
  let saved: MemoryState | null = await ledger.load();
  // One-time migration from the single-record format. The old record is removed only after its rows
  // are committed; if the app stops in between, the tables are already filled and it is just removed.
  const legacy = await kv.get(LEGACY_STATE_KEY);
  if (legacy !== null) {
    if (!saved) {
      saved = normalizeState(JSON.parse(legacy) as Partial<MemoryState>);
      await ledger.apply(stateToChangeSet(saved));
    }
    await kv.remove(LEGACY_STATE_KEY);
  }
  let sync: SyncRunner | null = null;
  const store = new MemoryStore(saved ?? undefined, {
    persistChanges: async (changes) => {
      await ledger.apply(changes);
      // A new local change waiting for upload → sync shortly (sync's own updates are never PENDING).
      if (changes.outbox.some((e) => e.status === 'PENDING')) sync?.kick();
    },
  });

  const initialPrefs: Record<string, unknown> = {};
  for (const key of PREF_KEYS) {
    const value = await kv.get(PREF_PREFIX + key);
    if (value !== null) initialPrefs[key] = JSON.parse(value);
  }

  const deps: EngineDeps = {
    store,
    // Back-office-managed config will replace this snapshot once the backend exists.
    config: DEFAULT_CONFIG,
    clock: systemClock,
    ids: { uuid: () => Crypto.randomUUID() },
    random: {
      int: (max) => {
        const buf = new Uint32Array(1);
        Crypto.getRandomValues(buf);
        return buf[0]! % max;
      },
    },
    pinHasher: {
      hash: (pin, salt) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `paspesa-pin:${salt}:${pin}`),
    },
    installationId,
  };

  await loadCachedServerConfig(deps, kv);
  const api = createApi(deps, kv, Platform.OS);
  let configListener: () => void = () => undefined;
  sync = createSyncRunner(deps, kv, api, Platform.OS, () => configListener());
  const runner = sync;
  await initSession({
    kv,
    api,
    deps,
    replaceLedger: (next) => store.replaceState(next, (s) => ledger.replace(s)),
    syncNow: () => runner.syncNow(),
  });
  return { deps, kv, initialPrefs, sync, api, onConfigChange: (listener) => { configListener = listener; } };
}
