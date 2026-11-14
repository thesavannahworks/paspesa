/** Money helpers. All amounts are whole Kenya shillings (integers). */

export function isWholeShillings(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function groupThousands(n: number): string {
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 25071 -> "25,071.00" (negative values keep a leading "-"). */
export function formatAmount(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${groupThousands(Math.abs(amount))}.00`;
}

/** Message style: "Ksh25,071.00". */
export function formatKshCompact(amount: number): string {
  return `Ksh${formatAmount(amount)}`;
}

/** Screen style: "Ksh 25,071.00". */
export function formatKsh(amount: number): string {
  return `Ksh ${formatAmount(amount)}`;
}

/**
 * Parses user input into whole shillings. Returns null for empty, non-numeric,
 * fractional or negative input. Thousands separators and surrounding spaces are allowed.
 */
export function parseWholeShillings(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}
