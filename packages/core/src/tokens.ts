/**
 * Central token wallet (White Paper §28): ONE balance whose tokens are tracked by source category and by
 * grant lot, backed by a ledger of every movement (the ledger is the source of truth, §28.4).
 *
 * Categories: PURCHASED (never expire by default), PROMOTIONAL and ADMIN (may expire, per lot).
 * Spending order (AGREED, §28.2): promotional → admin-issued → purchased. Within a category the lot that
 * expires first is used first (then the oldest), so the fewest tokens are lost to expiry.
 * Reversal (§33.2) restores the exact lots spent, as a separate ledger entry; nothing is erased.
 * Expiry (§28.3) is a permanent ledger entry per lot.
 *
 * These are pure functions: the backend applies their results inside its database transactions.
 */
export type TokenCategory = 'PROMOTIONAL' | 'ADMIN' | 'PURCHASED';

export const DEDUCTION_ORDER: TokenCategory[] = ['PROMOTIONAL', 'ADMIN', 'PURCHASED'];

export type TokenEntryType =
  | 'PURCHASE_CREDIT'
  | 'PROMOTIONAL_GRANT'
  | 'ADMIN_GRANT'
  | 'SIMULATION_EXPENDITURE'
  | 'EXPENDITURE_REVERSAL'
  | 'TOKEN_REFUND'
  | 'DEVICE_ALLOCATION'
  | 'DEVICE_RELEASE'
  | 'EXPIRATION'
  | 'LOST_DEVICE_FORFEITURE'
  | 'ADMIN_ADJUSTMENT';

/** A credit of tokens from one source, with its own expiry (§37.10). */
export interface TokenLot {
  id: string;
  walletId: string;
  category: TokenCategory;
  originalQuantity: number;
  remainingQuantity: number;
  createdAt: string;
  expiresAt: string | null;
  /** Payment, promotion or admin action that created it. */
  sourceReference: string;
}

/** One ledger line (§37.9). A spend over several lots is several lines with the same reference. */
export interface TokenLedgerEntry {
  id: string;
  walletId: string;
  entryType: TokenEntryType;
  category: TokenCategory;
  quantity: number;
  direction: 'CREDIT' | 'DEBIT';
  referenceType: 'PAYMENT' | 'SIMULATION' | 'PROMOTION' | 'ADMIN' | 'EXPIRY' | 'DEVICE';
  referenceId: string;
  lotId: string;
  deviceId: string | null;
  createdAt: string;
  expiresAt: string | null;
  metadata: Record<string, unknown> | null;
}

export const GRANT_ENTRY: Record<TokenCategory, TokenEntryType> = {
  PURCHASED: 'PURCHASE_CREDIT',
  PROMOTIONAL: 'PROMOTIONAL_GRANT',
  ADMIN: 'ADMIN_GRANT',
};

const isLive = (lot: TokenLot, at: string) => lot.remainingQuantity > 0 && (lot.expiresAt === null || Date.parse(lot.expiresAt) > Date.parse(at));

/** Spendable tokens per category and in total (expired lots excluded). */
export function walletBalances(lots: TokenLot[], at: string): Record<TokenCategory, number> & { total: number } {
  const out = { PROMOTIONAL: 0, ADMIN: 0, PURCHASED: 0, total: 0 };
  for (const lot of lots) {
    if (!isLive(lot, at)) continue;
    out[lot.category] += lot.remainingQuantity;
    out.total += lot.remainingQuantity;
  }
  return out;
}

export interface LotDeduction {
  lotId: string;
  category: TokenCategory;
  quantity: number;
}

export type DeductionPlan = { ok: true; deductions: LotDeduction[] } | { ok: false; available: number };

/** Which lots pay for `quantity` tokens, following the agreed priority. */
export function planDeduction(lots: TokenLot[], quantity: number, at: string): DeductionPlan {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Token quantity must be a whole number');
  const live = lots.filter((l) => isLive(l, at));
  const available = live.reduce((s, l) => s + l.remainingQuantity, 0);
  if (available < quantity) return { ok: false, available };
  const order = (l: TokenLot) => [DEDUCTION_ORDER.indexOf(l.category), l.expiresAt ? Date.parse(l.expiresAt) : Infinity, Date.parse(l.createdAt)] as const;
  const sorted = [...live].sort((a, b) => {
    const [ca, ea, ta] = order(a);
    const [cb, eb, tb] = order(b);
    return ca - cb || ea - eb || ta - tb || a.id.localeCompare(b.id);
  });
  const deductions: LotDeduction[] = [];
  let left = quantity;
  for (const lot of sorted) {
    if (left === 0) break;
    const take = Math.min(left, lot.remainingQuantity);
    deductions.push({ lotId: lot.id, category: lot.category, quantity: take });
    left -= take;
  }
  return { ok: true, deductions };
}

/** Lots whose expiry has passed with tokens left: each becomes an EXPIRATION entry (§28.3). */
export function planExpiry(lots: TokenLot[], at: string): LotDeduction[] {
  return lots
    .filter((l) => l.remainingQuantity > 0 && l.expiresAt !== null && Date.parse(l.expiresAt) <= Date.parse(at))
    .map((l) => ({ lotId: l.id, category: l.category, quantity: l.remainingQuantity }));
}

/**
 * Reconciliation (§28.4): every lot's remaining quantity must equal its credits minus its debits in the
 * ledger, and no lot may go negative. Returns the problems found (empty = consistent).
 */
export function reconcileWallet(lots: TokenLot[], ledger: TokenLedgerEntry[]): string[] {
  const problems: string[] = [];
  const net = new Map<string, number>();
  for (const e of ledger) net.set(e.lotId, (net.get(e.lotId) ?? 0) + (e.direction === 'CREDIT' ? e.quantity : -e.quantity));
  for (const lot of lots) {
    const fromLedger = net.get(lot.id) ?? 0;
    if (fromLedger !== lot.remainingQuantity) problems.push(`Lot ${lot.id}: ledger says ${fromLedger}, lot says ${lot.remainingQuantity}`);
    if (lot.remainingQuantity < 0 || lot.remainingQuantity > lot.originalQuantity) problems.push(`Lot ${lot.id}: remaining ${lot.remainingQuantity} is out of range`);
    net.delete(lot.id);
  }
  for (const id of net.keys()) problems.push(`Ledger entries refer to unknown lot ${id}`);
  return problems;
}
