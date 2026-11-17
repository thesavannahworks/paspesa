/**
 * Account settings and favourites. These change preferences, never money:
 * nothing here creates a transaction or a balance movement.
 */
import { counterpartyKey, describeCounterparty, getDefinition, type CounterpartyInput } from './catalogue';
import { checkPin, type EngineDeps } from './engine';
import { normalizeKenyanPhone } from './phone';
import type { Account, Counterparty, Favourite, SimulationType, TransactionRecord } from './types';
import { PIN_PATTERN, fail, outboxEntry, type Failure } from './util';

type Ok<T> = { ok: true } & T;

/** Set or change the simulated Paspesa PIN. Changing an existing PIN requires the current one. */
export async function setPin(
  deps: EngineDeps,
  input: { newPin: string; currentPin?: string },
): Promise<Ok<{ account: Account }> | Failure> {
  if (!PIN_PATTERN.test(input.newPin)) return fail('VALIDATION', 'Choose a 4-digit Paspesa PIN', { pin: 'Enter 4 digits' });
  return deps.store.runAtomic(async (tx) => {
    const account = await tx.getAccount();
    if (!account) return fail('NO_ACCOUNT', 'Set up your simulated account first');
    if (account.pin) {
      const failure = await checkPin({ ...deps, config: { ...deps.config, pinMode: 'USER_PIN' } }, account, input.currentPin);
      if (failure) return failure;
    }
    const salt = deps.ids.uuid();
    const now = deps.clock.now();
    const updated: Account = { ...account, pin: { salt, hash: await deps.pinHasher.hash(input.newPin, salt) }, updatedAt: now };
    await tx.putAccount(updated);
    await tx.enqueueOutbox(outboxEntry(deps.ids, deps.installationId, deps.ids.uuid(), 'ACCOUNT', account.id, 'UPDATE_ACCOUNT_SETTINGS', now, { kind: 'PIN_CHANGED' }));
    return { ok: true as const, account: updated };
  });
}

/**
 * Checks the simulated PIN without doing anything else (turning on biometrics, unlocking the app).
 * Follows the configured PIN mode, like payments.
 */
export async function verifyPin(deps: EngineDeps, pin: string): Promise<{ ok: true } | Failure> {
  const account = await deps.store.getAccount();
  if (!account) return fail('NO_ACCOUNT', 'Set up your simulated account first');
  return (await checkPin(deps, account, pin)) ?? { ok: true as const };
}

/**
 * Edit the details entered at setup (name, phone number). Past transactions, messages and statements
 * keep the values they were created with. The opening balance cannot be edited: it is a ledger entry.
 */
export async function updateAccountDetails(
  deps: EngineDeps,
  input: { accountName: string; phoneNumber: string },
): Promise<Ok<{ account: Account }> | Failure> {
  const accountName = input.accountName.replace(/\s+/g, ' ').trim();
  const phone = normalizeKenyanPhone(input.phoneNumber);
  const errors: Record<string, string> = {};
  if (!accountName) errors.accountName = 'Name is required';
  else if (accountName.length > 60) errors.accountName = 'Name must be at most 60 characters';
  if (!phone) errors.phoneNumber = 'Enter a valid Kenyan mobile number';
  if (Object.keys(errors).length) return fail('VALIDATION', 'Please correct the highlighted fields', errors);
  return deps.store.runAtomic(async (tx) => {
    const account = await tx.getAccount();
    if (!account) return fail('NO_ACCOUNT', 'Set up your simulated account first');
    const now = deps.clock.now();
    const updated: Account = { ...account, accountName, phoneNumber: phone!, updatedAt: now };
    await tx.putAccount(updated);
    await tx.enqueueOutbox(outboxEntry(deps.ids, deps.installationId, deps.ids.uuid(), 'ACCOUNT', account.id, 'UPDATE_ACCOUNT_SETTINGS', now, { kind: 'DETAILS', accountName, phoneNumber: phone! }));
    return { ok: true as const, account: updated };
  });
}

/** User-configurable default recharge sender. Pass null to return to the Paspesa default. */
export async function updateRechargeSenderDefaults(
  deps: EngineDeps,
  input: { name: string; phone: string } | null,
): Promise<Ok<{ account: Account }> | Failure> {
  let defaults: Account['rechargeSenderDefaults'] = null;
  if (input) {
    const name = input.name.replace(/\s+/g, ' ').trim();
    const phone = normalizeKenyanPhone(input.phone);
    const errors: Record<string, string> = {};
    if (!name) errors.name = 'Sender name is required';
    else if (name.length > 60) errors.name = 'Sender name must be at most 60 characters';
    if (!phone) errors.phone = 'Enter a valid Kenyan mobile number';
    if (Object.keys(errors).length) return fail('VALIDATION', 'Please correct the highlighted fields', errors);
    defaults = { name, phone: phone! };
  }
  return deps.store.runAtomic(async (tx) => {
    const account = await tx.getAccount();
    if (!account) return fail('NO_ACCOUNT', 'Set up your simulated account first');
    const now = deps.clock.now();
    const updated: Account = { ...account, rechargeSenderDefaults: defaults, updatedAt: now };
    await tx.putAccount(updated);
    await tx.enqueueOutbox(outboxEntry(deps.ids, deps.installationId, deps.ids.uuid(), 'ACCOUNT', account.id, 'UPDATE_ACCOUNT_SETTINGS', now, { kind: 'RECHARGE_SENDER', defaults }));
    return { ok: true as const, account: updated };
  });
}

/**
 * Reset the simulated airtime balance to zero (interim: nothing consumes airtime yet).
 * Does not touch the M-PESA balance or any transaction; the reset amount is accumulated so the
 * airtime balance stays reconcilable against own-number airtime purchases.
 */
export async function resetAirtimeBalance(deps: EngineDeps): Promise<Ok<{ account: Account; amountReset: number }> | Failure> {
  return deps.store.runAtomic(async (tx) => {
    const account = await tx.getAccount();
    if (!account) return fail('NO_ACCOUNT', 'Set up your simulated account first');
    if (account.airtimeBalance === 0) return { ok: true as const, account, amountReset: 0 };
    const now = deps.clock.now();
    const updated: Account = {
      ...account,
      airtimeBalance: 0,
      airtimeResetTotal: account.airtimeResetTotal + account.airtimeBalance,
      updatedAt: now,
    };
    await tx.putAccount(updated);
    await tx.enqueueOutbox(outboxEntry(deps.ids, deps.installationId, deps.ids.uuid(), 'ACCOUNT', account.id, 'UPDATE_ACCOUNT_SETTINGS', now, { kind: 'AIRTIME_RESET', amount: account.airtimeBalance }));
    return { ok: true as const, account: updated, amountReset: account.airtimeBalance };
  });
}

/** Marks all unread messages as read (opening the messages thread). */
export async function markAllMessagesRead(deps: EngineDeps): Promise<number> {
  return deps.store.runAtomic(async (tx) => {
    const now = deps.clock.now();
    const unread = (await tx.listMessages()).filter((m) => !m.readAt);
    for (const m of unread) await tx.markMessageRead(m.id, now);
    return unread.length;
  });
}

/**
 * Deletes messages from the Messages screen (single or bulk). Only the messages are hidden:
 * transactions and the M-PESA statement are never touched (statements can only be changed from
 * the admin back office).
 */
export async function deleteMessages(deps: EngineDeps, messageIds: readonly string[]): Promise<number> {
  const ids = new Set(messageIds);
  return deps.store.runAtomic(async (tx) => {
    const now = deps.clock.now();
    const targets = (await tx.listMessages()).filter((m) => ids.has(m.id) && !m.deletedAt);
    for (const m of targets) await tx.updateMessage({ ...m, deletedAt: now });
    return targets.length;
  });
}

/** Stars or un-stars a message ("Star message" in the message menu). */
export async function setMessageStarred(deps: EngineDeps, messageId: string, starred: boolean): Promise<void> {
  await deps.store.runAtomic(async (tx) => {
    const message = (await tx.listMessages()).find((m) => m.id === messageId);
    if (message && !message.deletedAt) await tx.updateMessage({ ...message, starred });
  });
}

/** Messages shown in the Messages screen (not deleted), oldest first like an SMS thread. */
export function visibleMessages<T extends { deletedAt?: string | null; createdAt: string }>(messages: readonly T[]): T[] {
  return messages.filter((m) => !m.deletedAt).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** Manually save a favourite. The counterparty is validated with the same rules as the transaction. */
export async function addFavourite(
  deps: EngineDeps,
  input: { type: SimulationType; variant?: string; counterparty: CounterpartyInput; label?: string },
): Promise<Ok<{ favourite: Favourite }> | Failure> {
  return deps.store.runAtomic(async (tx) => {
    const account = await tx.getAccount();
    if (!account) return fail('NO_ACCOUNT', 'Set up your simulated account first');
    const def = getDefinition(input.type);
    const { counterparty, variant, errors } = def.normalize(input.counterparty, { account, config: deps.config, variant: input.variant });
    if (Object.keys(errors).length) return fail('VALIDATION', 'Please correct the highlighted fields', errors);
    const key = counterpartyKey(input.type, variant, counterparty);
    if (!key) return fail('VALIDATION', 'This transaction type cannot be saved as a favourite');
    const now = deps.clock.now();
    const favourite: Favourite = {
      id: deps.ids.uuid(),
      accountId: account.id,
      type: input.type,
      key,
      label: (input.label ?? '').trim() || describeCounterparty({ type: input.type, variant, counterparty }).title,
      counterparty,
      createdAt: now,
    };
    await tx.upsertFavourite(favourite);
    await tx.enqueueOutbox(outboxEntry(deps.ids, deps.installationId, deps.ids.uuid(), 'FAVOURITE', favourite.id, 'UPSERT_FAVOURITE', now, { favourite }));
    return { ok: true as const, favourite };
  });
}

export async function removeFavourite(deps: EngineDeps, favouriteId: string): Promise<{ ok: true } | Failure> {
  return deps.store.runAtomic(async (tx) => {
    const now = deps.clock.now();
    await tx.deleteFavourite(favouriteId);
    await tx.enqueueOutbox(outboxEntry(deps.ids, deps.installationId, deps.ids.uuid(), 'FAVOURITE', favouriteId, 'DELETE_FAVOURITE', now, { favouriteId }));
    return { ok: true as const };
  });
}

export interface FavouriteSuggestion {
  type: SimulationType;
  key: string;
  label: string;
  counterparty: Counterparty;
  /** MANUAL = saved by the user; FREQUENT = used at least config.frequentThreshold times. */
  origin: 'MANUAL' | 'FREQUENT';
  useCount: number;
  lastUsedAt: string | null;
}

/**
 * Favourites shown on a transaction form = manual favourites ∪ frequent counterparties,
 * for the given types. Manual ones first, then frequent ones by use count.
 */
export function favouritesFor(
  types: SimulationType[],
  manual: Favourite[],
  transactions: TransactionRecord[],
  frequentThreshold: number,
): FavouriteSuggestion[] {
  const usage = new Map<string, { count: number; last: TransactionRecord }>();
  for (const tx of transactions) {
    if (tx.status !== 'SUCCESSFUL' || !types.includes(tx.type as SimulationType)) continue;
    const key = counterpartyKey(tx.type, tx.variant, tx.counterparty);
    if (!key) continue;
    const id = `${tx.type}|${key}`;
    const entry = usage.get(id);
    if (!entry) usage.set(id, { count: 1, last: tx });
    else {
      entry.count++;
      if (tx.sequence > entry.last.sequence) entry.last = tx;
    }
  }

  const result: FavouriteSuggestion[] = [];
  const seen = new Set<string>();
  for (const fav of manual.filter((f) => types.includes(f.type))) {
    const id = `${fav.type}|${fav.key}`;
    seen.add(id);
    const u = usage.get(id);
    result.push({
      type: fav.type, key: fav.key, label: fav.label, counterparty: fav.counterparty, origin: 'MANUAL',
      useCount: u?.count ?? 0, lastUsedAt: u?.last.completedAt ?? null,
    });
  }
  const frequent = [...usage.entries()]
    .filter(([id, u]) => !seen.has(id) && u.count >= frequentThreshold)
    .sort(([, a], [, b]) => b.count - a.count || b.last.sequence - a.last.sequence)
    .map(([, u]) => ({
      type: u.last.type as SimulationType,
      key: counterpartyKey(u.last.type, u.last.variant, u.last.counterparty)!,
      label: describeCounterparty(u.last).title,
      counterparty: u.last.counterparty,
      origin: 'FREQUENT' as const,
      useCount: u.count,
      lastUsedAt: u.last.completedAt,
    }));
  return [...result, ...frequent];
}
