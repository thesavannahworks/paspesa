/**
 * User-facing transaction reference, e.g. "UKFLA1YK4X" (10 characters).
 *
 * Structure observed in the supplied reference messages (08-messages, 09-statements):
 *   char 1     year   (A = 2006 … U = 2026, wraps every 26 years)
 *   char 2     month  (A = January … L = December)
 *   char 3     day    (1–9, then A = 10 … V = 31)
 *   chars 4–5  issuing node. The account holder's own payments carry "LA"; money received
 *              carries the sender's node (4U, 5R, AH, 9V … in the references).
 *   chars 6–10 base-36 counter that rises with time across the whole network. Fitted to the
 *              44 "LA" references from 5–15 Nov 2026: ≈ 2.41 per second (≈ 208,600 a day),
 *              zero at 2026-10-30 19:08 UTC, scattered by about an hour either way.
 *              e.g. 15 Nov 2026 16:08 EAT → "1YK4X".
 *
 * So a code generated now sits next to real codes generated at the same moment.
 * The reference is display data only. Idempotency uses the separate operationId (UUID).
 */
import type { RandomSource } from './ports';
import type { LocalParts } from './time';

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const COUNTER_LENGTH = 5;
const COUNTER_SPACE = 36 ** COUNTER_LENGTH;

/** Counter fit (see header). */
export const COUNTER_EPOCH_MS = Date.UTC(2026, 9, 30, 19, 8, 45);
export const COUNTER_RATE_PER_SECOND = 2.4147;
/** Random spread added to the counter (≈ ±40 minutes of network traffic), as in the references. */
const COUNTER_JITTER = 6_000;

/** Node used for the account holder's own payments. */
export const OWN_NODE = 'LA';

export function referencePrefix(p: LocalParts): string {
  const yearIndex = (((p.year - 2006) % 26) + 26) % 26;
  const year = String.fromCharCode(65 + yearIndex);
  const month = String.fromCharCode(64 + p.month);
  const day = p.day <= 9 ? String(p.day) : String.fromCharCode(65 + (p.day - 10));
  return `${year}${month}${day}`;
}

/** Network counter value at a moment, without jitter. */
export function referenceCounterAt(epochMs: number): number {
  const raw = Math.floor(((epochMs - COUNTER_EPOCH_MS) / 1000) * COUNTER_RATE_PER_SECOND);
  return ((raw % COUNTER_SPACE) + COUNTER_SPACE) % COUNTER_SPACE;
}

export function toBase36(value: number, length: number): string {
  let out = '';
  let n = value;
  for (let i = 0; i < length; i++) {
    out = BASE36[n % 36] + out;
    n = Math.floor(n / 36);
  }
  return out;
}

export interface ReferenceOptions {
  /** The transaction time (epoch ms); drives the counter. */
  epochMs: number;
  /** Two-character node. Omit for a random node (money received from someone else). */
  node?: string;
}

export function generateReference(p: LocalParts, random: RandomSource, options: ReferenceOptions): string {
  const node = options.node ?? BASE36[random.int(36)]! + BASE36[random.int(36)]!;
  const jitter = random.int(COUNTER_JITTER * 2 + 1) - COUNTER_JITTER;
  const counter = (((referenceCounterAt(options.epochMs) + jitter) % COUNTER_SPACE) + COUNTER_SPACE) % COUNTER_SPACE;
  return referencePrefix(p) + node + toBase36(counter, COUNTER_LENGTH);
}

export const REFERENCE_PATTERN = /^[A-Z][A-L][1-9A-V][A-Z0-9]{7}$/;
