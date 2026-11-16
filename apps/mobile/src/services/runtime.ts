import * as Crypto from 'expo-crypto';
import { DEFAULT_CONFIG, MemoryStore, systemClock, type EngineDeps, type MemoryState } from '@paspesa/core';
import { openKeyValueStore, type KeyValueStore } from './kv';

const STATE_KEY = 'ledger.state.v1';
const INSTALLATION_KEY = 'installation.id';
export const PREF_PREFIX = 'pref.';

export interface Runtime {
  deps: EngineDeps;
  kv: KeyValueStore;
  /** Preferences loaded at start-up (theme, balance visibility, …). Never financial data. */
  initialPrefs: Record<string, unknown>;
}

/** Every preference read at start-up. A key missing here is saved but not restored after a restart. */
const PREF_KEYS = ['theme', 'balanceHidden', 'frequentsOpen', 'profilePhoto'];

/**
 * Builds the offline-first runtime: the whole local ledger is loaded from device storage,
 * and every committed engine operation is written back atomically before it becomes visible.
 */
export async function createRuntime(): Promise<Runtime> {
  const kv = await openKeyValueStore();

  let installationId = await kv.get(INSTALLATION_KEY);
  if (!installationId) {
    installationId = Crypto.randomUUID();
    await kv.set(INSTALLATION_KEY, installationId);
  }

  const raw = await kv.get(STATE_KEY);
  const saved = raw ? (JSON.parse(raw) as Partial<MemoryState>) : undefined;
  const store = new MemoryStore(saved, { persist: (state) => kv.set(STATE_KEY, JSON.stringify(state)) });

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

  return { deps, kv, initialPrefs };
}
