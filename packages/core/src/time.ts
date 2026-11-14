/**
 * Date/time helpers using a fixed UTC offset (Kenya, EAT = UTC+3, no daylight saving).
 * A fixed offset keeps formatting identical on Android, iOS, web and the server,
 * without depending on each runtime's Intl time-zone support.
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

export function toLocalParts(isoTimestamp: string, utcOffsetMinutes: number): LocalParts {
  const ms = Date.parse(isoTimestamp);
  if (Number.isNaN(ms)) throw new Error(`Invalid timestamp: ${isoTimestamp}`);
  const d = new Date(ms + utcOffsetMinutes * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const pad2 = (n: number) => n.toString().padStart(2, '0');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "14/11/26" */
export function formatShortDate(p: LocalParts): string {
  return `${pad2(p.day)}/${pad2(p.month)}/${pad2(p.year % 100)}`;
}

/** "8:16 AM" */
export function formatTime12(p: LocalParts): string {
  const suffix = p.hour < 12 ? 'AM' : 'PM';
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h}:${pad2(p.minute)} ${suffix}`;
}

/** "2026-11-14" — stable key for date grouping. */
export function localDateKey(p: LocalParts): string {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** "14 November 2026" — statement group heading. */
export function formatLongDate(p: LocalParts): string {
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "14th Nov 2026 | 10:55 am" — success screen. */
export function formatResultTimestamp(p: LocalParts): string {
  const month = (MONTHS[p.month - 1] ?? '').slice(0, 3);
  return `${ordinal(p.day)} ${month} ${p.year} | ${formatTime12(p).toLowerCase()}`;
}

/** Converts a local calendar date (YYYY-MM-DD, start of day) to an ISO instant. */
export function localDayStartIso(dateKey: string, utcOffsetMinutes: number): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - utcOffsetMinutes * 60_000).toISOString();
}
