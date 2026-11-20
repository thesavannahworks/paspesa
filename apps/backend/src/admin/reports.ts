/**
 * Back-office reports (owner, 2026-11-20): how Paspesa is used over a period — simulations, accounts, money
 * received and tokens — by day (Kenya time) and by transaction type. Charts are plain SVG (no scripts or
 * inline styles: the back office's Content-Security-Policy), each bar with a hover title, and every chart
 * has its numbers in the daily table below (also downloadable as CSV).
 */
import type { Queryable } from '../database.js';
import { esc, html, ksh, raw, type Html } from './views.js';

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export interface DayRow { day: string; simulations: number; volume: number; newAccounts: number; tokenSales: number; directPayments: number; tokensSpent: number }

export interface Report {
  days: ReportPeriod;
  from: string;
  to: string;
  totals: { simulations: number; volume: number; fees: number; newAccounts: number; activeAccounts: number; tokenSales: number; directPayments: number; tokensSpent: number; tokensGranted: number };
  daily: DayRow[];
  byType: { type: string; count: number; volume: number; fees: number }[];
  payments: { status: string; count: number; amount: number }[];
}

const TZ = 'Africa/Nairobi';
const n = (v: unknown) => Number(v ?? 0);

export async function buildReport(q: Queryable, days: ReportPeriod, now = new Date()): Promise<Report> {
  // Whole Kenyan days: today and the days before it.
  const today = new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const fromDay = new Date(Date.parse(today) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const range = [fromDay, today];
  const inRange = (col: string) => `(${col} AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date`;
  const dayOf = (col: string) => `to_char((${col} AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD')`;

  const sims = await q.query<{ day: string; c: string; v: string; f: string }>(
    `SELECT ${dayOf('completed_at')} AS day, count(*) c, coalesce(sum(amount), 0) v, coalesce(sum(fee), 0) f FROM transactions
     WHERE type <> 'OPENING_BALANCE' AND ${inRange('completed_at')} GROUP BY 1`, range,
  );
  const accounts = await q.query<{ day: string; c: string }>(`SELECT ${dayOf('created_at')} AS day, count(*) c FROM accounts WHERE ${inRange('created_at')} GROUP BY 1`, range);
  const pays = await q.query<{ day: string; type: string; v: string }>(
    `SELECT ${dayOf('coalesce(verified_at, created_at)')} AS day, payment_type AS type, coalesce(sum(amount), 0) v FROM payments
     WHERE status = 'SUCCESSFUL' AND ${inRange('coalesce(verified_at, created_at)')} GROUP BY 1, 2`, range,
  );
  const spent = await q.query<{ day: string; v: string }>(
    `SELECT ${dayOf('created_at')} AS day, coalesce(sum(CASE WHEN entry_type = 'SIMULATION_EXPENDITURE' THEN quantity ELSE -quantity END), 0) v FROM token_ledger
     WHERE entry_type IN ('SIMULATION_EXPENDITURE', 'EXPENDITURE_REVERSAL') AND ${inRange('created_at')} GROUP BY 1`, range,
  );
  const [granted] = await q.query<{ v: string }>(
    `SELECT coalesce(sum(quantity), 0) v FROM token_ledger WHERE entry_type IN ('PROMOTIONAL_GRANT', 'ADMIN_GRANT') AND ${inRange('created_at')}`, range,
  );
  const [active] = await q.query<{ c: string }>(
    `SELECT count(DISTINCT account_id) c FROM transactions WHERE type <> 'OPENING_BALANCE' AND ${inRange('completed_at')}`, range,
  );
  const byType = await q.query<{ type: string; c: string; v: string; f: string }>(
    `SELECT type, count(*) c, coalesce(sum(amount), 0) v, coalesce(sum(fee), 0) f FROM transactions
     WHERE type <> 'OPENING_BALANCE' AND ${inRange('completed_at')} GROUP BY type ORDER BY count(*) DESC`, range,
  );
  const payments = await q.query<{ status: string; c: string; a: string }>(
    `SELECT status, count(*) c, coalesce(sum(amount), 0) a FROM payments WHERE ${inRange('created_at')} GROUP BY status ORDER BY status`, range,
  );

  const daily: DayRow[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.parse(fromDay) + i * 86_400_000).toISOString().slice(0, 10);
    const s = sims.find((r) => r.day === day);
    daily.push({
      day,
      simulations: n(s?.c),
      volume: n(s?.v),
      newAccounts: n(accounts.find((r) => r.day === day)?.c),
      tokenSales: n(pays.find((r) => r.day === day && r.type === 'TOKEN_PURCHASE')?.v),
      directPayments: n(pays.find((r) => r.day === day && r.type === 'DIRECT_SIMULATION')?.v),
      tokensSpent: n(spent.find((r) => r.day === day)?.v),
    });
  }
  const sum = (k: keyof Omit<DayRow, 'day'>) => daily.reduce((t, d) => t + d[k], 0);
  return {
    days, from: fromDay, to: today,
    totals: {
      simulations: sum('simulations'), volume: sum('volume'), fees: byType.reduce((t, r) => t + n(r.f), 0), newAccounts: sum('newAccounts'),
      activeAccounts: n(active?.c), tokenSales: sum('tokenSales'), directPayments: sum('directPayments'), tokensSpent: sum('tokensSpent'), tokensGranted: n(granted?.v),
    },
    daily,
    byType: byType.map((r) => ({ type: r.type, count: n(r.c), volume: n(r.v), fees: n(r.f) })),
    payments: payments.map((r) => ({ status: r.status, count: n(r.c), amount: n(r.a) })),
  };
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const label = (t: string) => t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * One series of bars by day: thin bars with a 2px gap, rounded data-end, a recessive baseline, the peak value
 * and a few dates as the only labels; each bar's <title> is its hover tooltip.
 */
function barChart(points: { day: string; value: number }[], format: (v: number) => string, title: string): Html {
  const W = 720, H = 220, top = 30, bottom = 34, left = 4, right = 4; // labels are in these units (the SVG scales to the panel)
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = (W - left - right) / points.length;
  const bar = Math.max(2, Math.min(28, slot - 2));
  const plot = H - top - bottom;
  const peak = points.reduce((b, p) => (p.value > b.value ? p : b), points[0]!);
  const ticks = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const parts = points.map((p, i) => {
    const h = p.value === 0 ? 0 : Math.max(3, (p.value / max) * plot);
    const x = left + i * slot + (slot - bar) / 2;
    const y = top + plot - h;
    const r = Math.min(4, bar / 2, h);
    // rounded top, square at the baseline
    const d = h === 0 ? '' : `M${x},${top + plot}V${y + r}Q${x},${y} ${x + r},${y}H${x + bar - r}Q${x + bar},${y} ${x + bar},${y + r}V${top + plot}Z`;
    return `<g class="slot"><rect class="hit" x="${x - 1}" y="${top}" width="${bar + 2}" height="${plot}"/>${d ? `<path class="bar" d="${d}"/>` : ''}<title>${esc(shortDay(p.day))}: ${esc(format(p.value))}</title></g>`
      + (ticks.has(i) ? `<text class="tick" x="${x + bar / 2}" y="${H - 6}" text-anchor="middle">${esc(shortDay(p.day))}</text>` : '');
  }).join('');
  const peakLabel = peak.value > 0
    ? `<text class="peak" x="${Math.min(W - 90, Math.max(60, left + points.indexOf(peak) * slot + slot / 2))}" y="${top - 9}" text-anchor="middle">${esc(format(peak.value))}</text>` : '';
  return raw(`<figure class="chart"><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} by day; the numbers are in the daily table below">
    <line class="base" x1="${left}" x2="${W - right}" y1="${top + plot}" y2="${top + plot}"/>${parts}${peakLabel}</svg></figure>`);
}

export function reportHtml(r: Report): Html {
  const t = r.totals;
  const tile = (k: string, v: string) => html`<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return html`
    <form method="get" class="panel period"><label for="days">Period</label>
      <select id="days" name="days">${REPORT_PERIODS.map((d) => html`<option value="${d}" ${d === r.days ? raw('selected') : ''}>Last ${d} days</option>`)}</select>
      <button class="secondary">Show</button>
      <a class="csv" href="/admin/reports.csv?days=${r.days}">Download daily table (CSV)</a></form>
    <p class="muted">${shortDay(r.from)} – ${shortDay(r.to)} (Kenya time). Money is real (what users paid Paspesa); balances and volumes are simulated.</p>
    <div class="cards">
      ${tile('Simulations', t.simulations.toLocaleString('en-KE'))}${tile('Simulated volume', ksh(t.volume))}
      ${tile('Active accounts', String(t.activeAccounts))}${tile('New accounts', String(t.newAccounts))}
      ${tile('Token sales', ksh(t.tokenSales))}${tile('Direct payments', ksh(t.directPayments))}
      ${tile('Tokens spent', t.tokensSpent.toLocaleString('en-KE'))}${tile('Tokens granted', t.tokensGranted.toLocaleString('en-KE'))}
    </div>
    <div class="row">
      <div class="panel">${barChart(r.daily.map((d) => ({ day: d.day, value: d.simulations })), (v) => `${v} simulation${v === 1 ? '' : 's'}`, 'Simulations per day')}</div>
      <div class="panel">${barChart(r.daily.map((d) => ({ day: d.day, value: d.tokenSales + d.directPayments })), (v) => ksh(v), 'Money received per day (KSh)')}</div>
    </div>
    <div class="row">
      <div class="panel"><h2>By transaction type</h2><table><tr><th>Type</th><th class="num">Count</th><th class="num">Simulated volume</th><th class="num">Simulated fees</th></tr>
        ${r.byType.map((b) => html`<tr><td>${label(b.type)}</td><td class="num">${b.count}</td><td class="num">${ksh(b.volume)}</td><td class="num">${ksh(b.fees)}</td></tr>`)}</table></div>
      <div class="panel"><h2>Payments</h2><table><tr><th>Outcome</th><th class="num">Count</th><th class="num">KSh</th></tr>
        ${r.payments.map((p) => html`<tr><td>${label(p.status)}</td><td class="num">${p.count}</td><td class="num">${ksh(p.amount)}</td></tr>`)}</table></div>
    </div>
    <div class="panel"><h2>Daily</h2><table><tr><th>Day</th><th class="num">Simulations</th><th class="num">Simulated volume</th><th class="num">New accounts</th><th class="num">Token sales</th><th class="num">Direct payments</th><th class="num">Tokens spent</th></tr>
      ${[...r.daily].reverse().map((d) => html`<tr><td>${shortDay(d.day)}</td><td class="num">${d.simulations}</td><td class="num">${ksh(d.volume)}</td><td class="num">${d.newAccounts}</td><td class="num">${ksh(d.tokenSales)}</td><td class="num">${ksh(d.directPayments)}</td><td class="num">${d.tokensSpent}</td></tr>`)}</table></div>`;
}

export function reportCsv(r: Report): string {
  const lines = ['day,simulations,simulated_volume_ksh,new_accounts,token_sales_ksh,direct_payments_ksh,tokens_spent'];
  for (const d of r.daily) lines.push([d.day, d.simulations, d.volume, d.newAccounts, d.tokenSales, d.directPayments, d.tokensSpent].join(','));
  return lines.join('\n') + '\n';
}
