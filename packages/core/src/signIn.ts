/**
 * Account sign-in (email + one-time code) and restoring an account onto a device.
 *
 * One active device per account: transactions are numbered in order on the device that records them, so
 * two devices recording at once would collide. Signing in on another device moves the account there; the
 * previous device uploads what it recorded before, then signs itself out.
 *
 * The simulated PIN never leaves a device: after a restore the user creates a PIN on the new device.
 */
import { deriveBalance } from './ledger';
import type { MemoryState } from './memoryStore';
import type { SyncAccount, SyncMessage, SyncTransaction } from './sync';
import type { Account, BalanceMovement, Favourite, MessageRecord, TransactionRecord } from './types';

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const SIGN_IN_CODE_LENGTH = 6;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isValidEmail = (email: string) => EMAIL_PATTERN.test(normalizeEmail(email)) && normalizeEmail(email).length <= 200;

/** What a successful sign-in tells the device. */
export interface SignInResult {
  email: string;
  /** The account this email owns on the server (null: none yet — the device sets one up). */
  accountId: string | null;
  /** The account was active on another device, which is now being signed out. */
  movedFromAnotherDevice: boolean;
}

/** Whether this device is signed in (GET /v1/auth/me). */
export interface SignInStatus {
  signedIn: boolean;
  email: string | null;
  accountId: string | null;
  /** Another device signed in to this account: upload what is left, then sign out. */
  signedOutElsewhere: boolean;
}

/** Everything a device needs to continue an account (GET /v1/account/restore). */
export interface AccountSnapshot {
  account: SyncAccount & {
    balance: number;
    airtimeBalance: number;
    airtimeResetTotal: number;
    rechargeSenderDefaults: { name: string; phone: string } | null;
    version: number;
    updatedAt: string;
  };
  /** Oldest first (by sequence). */
  transactions: SyncTransaction[];
  messages: SyncMessage[];
  favourites: Favourite[];
}

/**
 * Builds the device's local state from a server snapshot. Everything restored is already synchronized;
 * messages arrive as read. Throws if the transactions don't add up to the server's balance.
 */
export function stateFromSnapshot(
  snapshot: AccountSnapshot,
  installationId: string,
  /** Reloading on the same device keeps its PIN and its tokens set aside. */
  keep: Pick<Account, 'pin' | 'tokenAllocation'> | null = null,
): MemoryState {
  const a = snapshot.account;
  const transactions: TransactionRecord[] = [...snapshot.transactions]
    .sort((x, y) => x.sequence - y.sequence)
    .map((t) => ({ ...t, syncStatus: 'SYNCED' }));
  const movements: BalanceMovement[] = transactions.map((t) => ({
    id: `mv-${t.id}`,
    accountId: a.id,
    transactionId: t.id,
    movementType: t.type === 'OPENING_BALANCE' ? 'OPENING' : t.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT',
    amount: t.direction === 'DEBIT' ? t.totalDebit : t.amount,
    direction: t.direction,
    balanceBefore: t.balanceBefore,
    balanceAfter: t.balanceAfter,
    createdAt: t.completedAt,
    sourceReference: t.reference,
  }));
  const derived = deriveBalance(movements);
  if (derived !== a.balance) throw new Error(`Restored transactions add up to ${derived}, the server balance is ${a.balance}`);
  const account: Account = {
    id: a.id,
    installationId,
    accountName: a.accountName,
    phoneNumber: a.phoneNumber,
    openingBalance: a.openingBalance,
    currentBalanceCache: a.balance,
    airtimeBalance: a.airtimeBalance,
    airtimeResetTotal: a.airtimeResetTotal,
    rechargeSenderDefaults: a.rechargeSenderDefaults,
    tokenAllocation: keep?.tokenAllocation ?? null,
    pin: keep?.pin ?? null,
    currency: 'KES',
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    version: a.version,
  };
  const messages: MessageRecord[] = snapshot.messages.map((m) => ({ ...m, accountId: a.id, readAt: m.createdAt, syncStatus: 'SYNCED' }));
  return { account, transactions, movements, messages, outbox: [], favourites: snapshot.favourites.map((f) => ({ ...f, accountId: a.id })) };
}
