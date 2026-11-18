/**
 * Kenyan mobile number helpers.
 * Accepted input forms: 07XXXXXXXX, 01XXXXXXXX, 7XXXXXXXX, 2547XXXXXXXX, +2547XXXXXXXX (and the 1-prefix equivalents).
 * Canonical storage form: 254XXXXXXXXX.
 */

export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

/** 254111000222 -> 0111000222 */
export function toLocalPhone(normalized: string): string {
  return normalized.startsWith('254') ? `0${normalized.slice(3)}` : normalized;
}

/** 254745123456 -> 0745***456 (as in incoming-money messages and statements). */
export function maskPhone(normalized: string): string {
  const local = toLocalPhone(normalized);
  if (local.length < 8) return local;
  return `${local.slice(0, 4)}***${local.slice(-3)}`;
}
