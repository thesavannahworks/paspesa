/**
 * Ledger integrity checks (White Paper §10.5, §38).
 * Current balance = sum of all balance movements (the opening balance is the first movement).
 * The cached balance must always reconcile with the movements.
 */
import { findTemplate } from './messages/templates';
import type { StoreReader } from './store';
import type { BalanceMovement } from './types';

export interface ReconciliationReport {
  ok: boolean;
  cachedBalance: number | null;
  derivedBalance: number;
  issues: string[];
}

export function deriveBalance(movements: BalanceMovement[]): number {
  return movements.reduce((sum, m) => sum + (m.direction === 'CREDIT' ? m.amount : -m.amount), 0);
}

export async function reconcileAccount(store: StoreReader): Promise<ReconciliationReport> {
  const [account, movements, transactions] = await Promise.all([
    store.getAccount(),
    store.listMovements(),
    store.listTransactions(),
  ]);
  const issues: string[] = [];
  const derivedBalance = deriveBalance(movements);

  if (!account) {
    if (movements.length || transactions.length) issues.push('Ledger records exist without an account');
    return { ok: issues.length === 0, cachedBalance: null, derivedBalance, issues };
  }

  if (account.currentBalanceCache !== derivedBalance) {
    issues.push(`Cached balance ${account.currentBalanceCache} differs from ledger balance ${derivedBalance}`);
  }

  const opening = movements.filter((m) => m.movementType === 'OPENING');
  if (opening.length !== 1) issues.push(`Expected exactly one opening movement, found ${opening.length}`);
  else if (opening[0]!.amount !== account.openingBalance) issues.push('Opening movement does not match account opening balance');

  const ordered = [...transactions].sort((a, b) => a.sequence - b.sequence);
  let running = 0;
  ordered.forEach((tx, i) => {
    if (tx.sequence !== i + 1) issues.push(`Sequence gap at ${tx.reference}: expected ${i + 1}, found ${tx.sequence}`);
    if (tx.balanceBefore !== running) issues.push(`${tx.reference}: balanceBefore ${tx.balanceBefore} ≠ running ${running}`);
    const delta = tx.direction === 'CREDIT' ? tx.amount : -tx.totalDebit;
    if (tx.balanceAfter !== tx.balanceBefore + delta) issues.push(`${tx.reference}: balanceAfter is inconsistent`);
    if (tx.direction === 'DEBIT' && tx.totalDebit !== tx.amount + tx.fee) issues.push(`${tx.reference}: totalDebit ≠ amount + fee`);
    const txMovements = movements.filter((m) => m.transactionId === tx.id);
    if (txMovements.length !== 1) issues.push(`${tx.reference}: expected 1 balance movement, found ${txMovements.length}`);
    running = tx.balanceAfter;
  });
  if (ordered.length && running !== account.currentBalanceCache) {
    issues.push(`Last transaction balance ${running} differs from cached balance ${account.currentBalanceCache}`);
  }

  const ownAirtime = transactions
    .filter((t) => t.type === 'AIRTIME' && t.variant === 'OWN' && t.status === 'SUCCESSFUL')
    .reduce((sum, t) => sum + t.amount, 0);
  if (account.airtimeBalance !== ownAirtime - account.airtimeResetTotal) {
    issues.push(
      `Airtime balance ${account.airtimeBalance} differs from own-number purchases ${ownAirtime} minus resets ${account.airtimeResetTotal}`,
    );
  }

  for (const tx of transactions) {
    if (tx.type === 'OPENING_BALANCE') continue;
    const expectsMessage = findTemplate(tx.type, tx.variant) !== null;
    const message = await store.getMessageByTransactionId(tx.id);
    if (expectsMessage && !message) issues.push(`${tx.reference}: confirmation message missing`);
    if (message && !message.body.includes(tx.reference)) issues.push(`${tx.reference}: message does not reference its transaction`);
  }

  return { ok: issues.length === 0, cachedBalance: account.currentBalanceCache, derivedBalance, issues };
}
