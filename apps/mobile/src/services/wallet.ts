/**
 * Paspesa token wallet data from the backend (White Paper §28–31), for the Profile → Paspesa Tokens pages.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { ServerAllocation } from '@paspesa/core';
import { ApiError, useApi } from './api';

export interface WalletView {
  balances: { PROMOTIONAL: number; ADMIN: number; PURCHASED: number; total: number };
  reservedForDevices: number;
  ledger: { type: string; category: string; quantity: number; direction: 'CREDIT' | 'DEBIT'; reference: string; at: string }[];
}

export interface PaymentView {
  id: string;
  paymentType: 'TOKEN_PURCHASE' | 'DIRECT_SIMULATION';
  provider: string;
  amount: number;
  tokens: number | null;
  status: 'INITIATED' | 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  simulationStatus: string;
  refundStatus: string;
  createdAt: string;
}

/** Loads on every visit to the screen; `error` is a friendly message (offline, not set up…). */
export function useRemote<T>(path: string | null) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api.get<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [api, path]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return { data, error, loading, reload: load };
}

export type CurrentAllocation = { allocation: ServerAllocation | null };

/** Plain-language names for wallet ledger entries (§28.1). */
export const ENTRY_LABEL: Record<string, string> = {
  PURCHASE_CREDIT: 'Tokens bought',
  PROMOTIONAL_GRANT: 'Promotional tokens',
  ADMIN_GRANT: 'Tokens from Paspesa',
  SIMULATION_EXPENDITURE: 'Simulation',
  EXPENDITURE_REVERSAL: 'Simulation refunded',
  TOKEN_REFUND: 'Refund',
  DEVICE_ALLOCATION: 'Set aside on a phone',
  DEVICE_RELEASE: 'Returned from a phone',
  EXPIRATION: 'Expired',
  LOST_DEVICE_FORFEITURE: 'Lost phone',
  ADMIN_ADJUSTMENT: 'Adjustment',
};

export const CATEGORY_LABEL: Record<string, string> = { PURCHASED: 'Purchased', PROMOTIONAL: 'Promotional', ADMIN: 'From Paspesa' };

/** Spending-type entries (what tokens were used for or lost to). */
export const SPENDING_ENTRIES = new Set(['SIMULATION_EXPENDITURE', 'EXPENDITURE_REVERSAL', 'EXPIRATION', 'LOST_DEVICE_FORFEITURE']);

export const shortDate = (iso: string) => {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};
