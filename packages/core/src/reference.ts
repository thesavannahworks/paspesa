/**
 * User-facing transaction reference, e.g. "UKE7Q2M9XA" (10 characters).
 *
 * Structure observed in the supplied reference messages:
 *   char 1  year   (A = 2006 … U = 2026, wraps every 26 years)
 *   char 2  month  (A = January … L = December)
 *   char 3  day    (1–9, then A = 10 … V = 31)
 *   chars 4–10     random [A-Z0-9]
 *
 * The reference is display data only. Idempotency uses the separate operationId (UUID).
 */
import type { RandomSource } from './ports';
import type { LocalParts } from './time';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RANDOM_LENGTH = 7;

export function referencePrefix(p: LocalParts): string {
  const yearIndex = (((p.year - 2006) % 26) + 26) % 26;
  const year = String.fromCharCode(65 + yearIndex);
  const month = String.fromCharCode(64 + p.month);
  const day = p.day <= 9 ? String(p.day) : String.fromCharCode(65 + (p.day - 10));
  return `${year}${month}${day}`;
}

export function generateReference(p: LocalParts, random: RandomSource): string {
  let suffix = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) suffix += ALPHANUMERIC[random.int(ALPHANUMERIC.length)];
  return referencePrefix(p) + suffix;
}

export const REFERENCE_PATTERN = /^[A-Z][A-L][1-9A-V][A-Z0-9]{7}$/;
