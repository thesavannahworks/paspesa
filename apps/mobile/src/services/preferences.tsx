import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { KeyValueStore } from './kvTypes';
import { PREF_PREFIX } from './runtime';

interface PrefsContextValue {
  values: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PreferencesProvider({ kv, initial, children }: { kv: KeyValueStore; initial: Record<string, unknown>; children: ReactNode }) {
  const [values, setValues] = useState(initial);
  const set = useCallback(
    (key: string, value: unknown) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      kv.set(PREF_PREFIX + key, JSON.stringify(value)).catch((e) => console.warn('[paspesa] preference not saved', e));
    },
    [kv],
  );
  return <PrefsContext.Provider value={{ values, set }}>{children}</PrefsContext.Provider>;
}

export function usePreference<T>(key: string, fallback: T): [T, (value: T) => void] {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePreference must be used inside PreferencesProvider');
  const value = (key in ctx.values ? ctx.values[key] : fallback) as T;
  const setValue = useCallback((v: T) => ctx.set(key, v), [ctx, key]);
  return [value, setValue];
}
