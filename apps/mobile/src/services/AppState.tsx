import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Account, EngineDeps, Favourite, MessageRecord, TransactionRecord } from '@paspesa/core';

export interface LedgerSnapshot {
  account: Account | null;
  transactions: TransactionRecord[];
  messages: MessageRecord[];
  favourites: Favourite[];
}

interface AppStateValue extends LedgerSnapshot {
  deps: EngineDeps;
  /** Re-reads the local ledger. Call after every engine operation. */
  refresh: () => Promise<void>;
  /** The most recent non-empty account (see useAccount). */
  lastAccount: Account | null;
}

const AppStateContext = createContext<AppStateValue | null>(null);

async function read(deps: EngineDeps): Promise<LedgerSnapshot> {
  const { store } = deps;
  const [account, transactions, messages, favourites] = await Promise.all([
    store.getAccount(),
    store.listTransactions(),
    store.listMessages(),
    store.listFavourites(),
  ]);
  return { account, transactions: [...transactions].sort((a, b) => b.sequence - a.sequence), messages, favourites };
}

export function AppStateProvider({ deps, children }: { deps: EngineDeps; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  // The last account seen: screens that need one keep rendering it for the moment between a sign-out
  // wiping the device and the app leaving those screens.
  const [lastAccount, setLastAccount] = useState<Account | null>(null);
  const refresh = useCallback(async () => {
    const next = await read(deps);
    if (next.account) setLastAccount(next.account);
    setSnapshot(next);
  }, [deps]);
  useEffect(() => {
    let live = true;
    void read(deps).then((s) => {
      if (!live) return;
      if (s.account) setLastAccount(s.account);
      setSnapshot(s);
    });
    return () => {
      live = false;
    };
  }, [deps]);
  if (!snapshot) return null;
  return <AppStateContext.Provider value={{ ...snapshot, deps, refresh, lastAccount }}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}

/** For screens that only render once an account exists. */
export function useAccount(): Account {
  const { account, lastAccount } = useAppState();
  const shown = account ?? lastAccount;
  if (!shown) throw new Error('No account set up');
  return shown;
}
