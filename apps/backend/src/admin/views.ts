/**
 * Back-office HTML. Server-rendered, no JavaScript (a strict Content-Security-Policy forbids scripts).
 * Every value is HTML-escaped: account names and other text come from users.
 */
import type { AdminSession } from './auth.js';

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Trusted HTML fragments built from escaped parts. */
export class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

/** Tagged template: interpolations are escaped unless they are Html (or arrays of Html). */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]!;
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x instanceof Html ? x.value : esc(x))).join('') : v instanceof Html ? v.value : esc(v);
    out += part + strings[i + 1]!;
  });
  return new Html(out);
}

export const raw = (s: string) => new Html(s);

const NAV: [string, string][] = [
  ['/admin', 'Dashboard'],
  ['/admin/reports', 'Reports'],
  ['/admin/accounts', 'Accounts'],
  ['/admin/devices', 'Devices'],
  ['/admin/payments', 'Payments'],
  ['/admin/review', 'Review queue'],
  ['/admin/pricing', 'Pricing'],
  ['/admin/fees', 'Fees'],
  ['/admin/settings', 'Settings'],
  ['/admin/audit', 'Audit log'],
  ['/admin/users', 'Admin users'],
  ['/admin/me', 'My account'],
];

export function layout(title: string, session: AdminSession | null, body: Html, active = ''): string {
  // Phones: a top bar with a Menu button opens the same navigation (admin.js; without scripts it stays open).
  const topbar = session
    ? html`<div class="topbar"><div class="brand">Paspesa <span>Back office</span></div><button type="button" class="secondary menu-btn" aria-controls="nav" aria-expanded="false" hidden>Menu</button></div>`
    : html``;
  const nav = session
    ? html`<nav class="side" id="nav"><div class="brand">Paspesa <span>Back office</span></div>
        ${NAV.map(([href, label]) => html`<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`)}
        <form method="post" action="/admin/logout" class="logout">${csrf(session)}<button class="link">Sign out</button></form>
      </nav>`
    : html``;
  const who = session ? html`<div class="who"><a href="/admin/me">${session.admin.name}</a> · <b>${session.admin.role}</b></div>` : html``;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Paspesa back office</title><link rel="stylesheet" href="/admin/assets/admin.css"><script src="/admin/assets/admin.js" defer></script></head>
<body class="${session ? 'app' : 'plain'}">${topbar.value}${nav.value}<main><header><h1>${esc(title)}</h1>${who.value}</header>${body.value}</main></body></html>`;
}

export const csrf = (session: AdminSession) => html`<input type="hidden" name="_csrf" value="${session.csrf}">`;

export const notice = (text: string | undefined, kind: 'ok' | 'error' = 'ok') => (text ? html`<p class="notice ${kind}">${text}</p>` : html``);

export const fmtDate = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
};

export const ksh = (n: unknown) => `KSh ${Number(n ?? 0).toLocaleString('en-KE')}`;

/** A password input with a Show/Hide button (the button stays hidden if scripts don't run). */
export const passwordField = (id: string, name: string, autocomplete: string) =>
  html`<div class="pw"><input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required><button type="button" class="secondary pw-toggle" data-for="${id}" aria-controls="${id}" aria-pressed="false" hidden>Show</button></div>`;

/** Served at /admin/assets/admin.js — the back office's only script (inline scripts are blocked by the CSP). */
export const ADMIN_JS = `document.querySelectorAll('.pw-toggle').forEach(function (b) {
  var input = document.getElementById(b.getAttribute('data-for'));
  if (!input) return;
  b.hidden = false;
  b.addEventListener('click', function () {
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? 'Hide' : 'Show';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });
  b.setAttribute('aria-label', 'Show password');
});
// Phones: the navigation opens from the top bar's Menu button.
(function () {
  var btn = document.querySelector('.menu-btn');
  if (!btn) return;
  document.documentElement.classList.add('js');
  btn.hidden = false;
  btn.addEventListener('click', function () {
    var open = document.body.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Close' : 'Menu';
  });
})();
// Tables with a header row become stacked cards on phones: each cell gets its column name as a label.
document.querySelectorAll('table').forEach(function (t) {
  var head = t.rows[0];
  if (head && t.rows.length === 1 && head.cells.length > 2 && head.cells[0].tagName === 'TH') {
    // a list with no rows: say so instead of showing column names over nothing (unless the page already does)
    var next = t.nextElementSibling;
    if (next && next.classList.contains('muted')) { t.remove(); return; }
    var none = document.createElement('p');
    none.className = 'muted';
    none.textContent = 'Nothing yet.';
    t.replaceWith(none);
    return;
  }
  if (!head || t.rows.length < 2) return;
  var cells = Array.prototype.slice.call(head.cells);
  if (cells.length < 3 || cells.some(function (c) { return c.tagName !== 'TH'; })) return;
  t.classList.add('stack');
  head.classList.add('head');
  for (var i = 1; i < t.rows.length; i++) {
    Array.prototype.forEach.call(t.rows[i].cells, function (c, j) {
      var label = cells[j] ? cells[j].textContent.trim() : '';
      if (label) c.setAttribute('data-label', label); else c.classList.add('nolabel');
    });
  }
});
// Forms marked data-dirty: their submit buttons stay disabled until a field differs from how the page
// loaded (changing a value back disables them again). Without JavaScript the buttons simply work.
document.querySelectorAll('form[data-dirty]').forEach(function (f) {
  var fields = Array.prototype.filter.call(f.elements, function (e) { return e.name && e.type !== 'hidden' && e.tagName !== 'BUTTON'; });
  var snap = function () { return fields.map(function (e) { return e.type === 'checkbox' || e.type === 'radio' ? String(e.checked) : e.value; }).join(''); };
  var start = snap();
  var buttons = Array.prototype.filter.call(f.querySelectorAll('button'), function (b) { return b.type !== 'button'; });
  var update = function () {
    var changed = snap() !== start;
    buttons.forEach(function (b) { b.disabled = !changed; b.title = changed ? '' : 'Nothing has changed yet'; });
  };
  f.addEventListener('input', update);
  f.addEventListener('change', update);
  update();
});
`;

export const ADMIN_CSS = `
.review{border-bottom:1px solid var(--line);padding:12px 0}.review:last-child{border-bottom:0}.review p{margin:6px 0}.review .explain{background:var(--bg);border-radius:8px;padding:8px 10px}.ok-text{color:var(--accent)}.review-actions form{flex:1;min-width:240px}
.qr{width:200px;margin:12px 0;padding:8px;background:#fff;border-radius:8px}.qr svg{display:block;width:100%;height:auto}
code.key{font-size:15px;letter-spacing:1px}ol.steps li{margin:0 0 14px}ol.steps form{display:flex;gap:8px;align-items:center;max-width:420px;margin-top:8px}ol.steps form button{margin-top:0}ul.codes{columns:2;max-width:360px;font-size:16px;line-height:2}
.pw{display:flex;gap:8px;align-items:center;max-width:420px}.pw input{flex:1}.pw .pw-toggle{margin-top:0;white-space:nowrap}
:root{--bg:#f5f6f8;--panel:#fff;--text:#16181d;--muted:#5d6572;--line:#e3e6ea;--accent:#2e9e3f;--accent-soft:#e8f6ea;--red:#c62f3b;--red-soft:#fdecee;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--panel:#1b1e23;--text:#eceef1;--muted:#9aa2ae;--line:#2b3038;--accent:#3fbd52;--accent-soft:#163020;--red:#ff6b76;--red-soft:#3a1a1e;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
body.app{display:grid;grid-template-columns:230px 1fr;min-height:100vh}
.side{background:var(--panel);border-right:1px solid var(--line);padding:18px 12px;display:flex;flex-direction:column;gap:2px;position:sticky;top:0;height:100vh}
.brand{font-weight:700;font-size:18px;padding:4px 10px 16px;color:var(--accent)}.brand span{display:block;font-size:12px;font-weight:500;color:var(--muted)}
.side a{color:var(--text);text-decoration:none;padding:8px 10px;border-radius:8px}.side a:hover{background:var(--bg)}.side a.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.logout{margin-top:auto}main{padding:22px 28px;max-width:1200px;width:100%}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:24px 0 10px}
.who{color:var(--muted);font-size:14px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.cards{margin-bottom:16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.card .k{color:var(--muted);font-size:13px}.card .v{font-size:22px;font-weight:650;margin-top:4px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:13px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--bg);border:1px solid var(--line)}.pill.ok{background:var(--accent-soft);color:var(--accent);border-color:transparent}.pill.bad{background:var(--red-soft);color:var(--red);border-color:transparent}
input.check{width:auto;margin-right:6px}form.inline{display:inline}label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
input,select,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:100%;max-width:420px}
textarea{max-width:640px;min-height:90px;font-family:ui-monospace,monospace;font-size:13px}
button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;margin-top:12px}button.secondary{background:var(--bg);color:var(--text);border:1px solid var(--line)}
button.danger{background:var(--red)}button:disabled{opacity:.4;cursor:not-allowed;filter:saturate(.4)}button.link{background:none;color:var(--muted);padding:8px 10px;margin:0}
.notice{padding:10px 12px;border-radius:8px;margin:0 0 16px}.notice.ok{background:var(--accent-soft);color:var(--accent)}.notice.error{background:var(--red-soft);color:var(--red)}
.chart{margin:0}.chart figcaption{font-weight:600;font-size:15px;margin-bottom:6px}.chart svg{width:100%;height:auto;display:block}
.chart .bar{fill:var(--accent)}.chart .hit{fill:transparent}.chart .slot:hover .bar{opacity:.75}.chart .slot:hover .hit{fill:var(--accent-soft)}
.chart .base{stroke:var(--line);stroke-width:1}.chart .tick,.chart .peak{fill:var(--muted);font-size:20px}.chart .peak{fill:var(--text);font-weight:600}
form.period{display:flex;flex-wrap:wrap;gap:10px;align-items:center}form.period label{margin:0}form.period select{width:auto}form.period button{margin:0}form.period .csv{margin-left:auto}
.muted{color:var(--muted)}table.fees input{max-width:140px;text-align:right}table.fees td{text-align:right}.row{display:flex;gap:16px;flex-wrap:wrap}.row>*{flex:1;min-width:260px}a{color:var(--accent)}
body.plain main{max-width:380px;margin:12vh auto}
/* ---- phones and narrow windows ---- */
.topbar{display:none}
@media (max-width:760px){
  body.app{display:block}
  .topbar{display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;background:var(--panel);border-bottom:1px solid var(--line);padding:8px 14px}
  .topbar .brand{padding:0;font-size:17px}.topbar .brand span{display:inline;margin-left:6px}
  .menu-btn{margin:0;padding:7px 14px}
  .side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:8px 10px 12px}
  .side .brand{display:none}
  html.js .side{display:none}html.js body.nav-open .side{display:flex}
  .side a{padding:11px 12px;font-size:16px}.logout{margin-top:6px}
  main{padding:14px}
  header{flex-wrap:wrap;gap:4px;margin-bottom:14px}h1{font-size:20px}
  .cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card .v{font-size:19px}
  .panel{padding:12px;border-radius:10px}
  .row>*{min-width:0;flex-basis:100%}
  input,select,textarea{max-width:none;font-size:16px}
  button{padding:10px 16px}
  form:not(.inline)>button,details form>button{width:100%}
  ol.steps form,.pw{max-width:none;flex-wrap:wrap}
  ol.steps{padding-left:18px}
  /* tables with a header row: one card per row, each value labelled */
  table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
  table.stack tr.head{display:none}
  table.stack tr{border:1px solid var(--line);border-radius:10px;padding:6px 10px;margin-bottom:10px;background:var(--panel)}
  table.stack td{border:0;padding:5px 0;display:flex;gap:12px;justify-content:space-between;text-align:right;overflow-wrap:anywhere}
  table.stack td::before{content:attr(data-label);color:var(--muted);font-size:12px;text-align:left;flex:0 0 38%}
  table.stack td.nolabel{justify-content:flex-start;text-align:left}table.stack td.nolabel::before{content:none}
  table.stack td.num{text-align:right}
  table.fees tr.head{display:table-row}table.fees,table.fees tbody{display:table}table.fees tr{display:table-row;border:0;padding:0;margin:0;background:none}table.fees td{display:table-cell;padding:4px}table.fees td::before{content:none}
  table.stack td:empty{display:none}
  table.stack td form{margin:0}table.stack td details{width:100%;text-align:left}
}
@media (max-width:420px){.cards{grid-template-columns:1fr 1fr}.card{padding:10px 12px}}
`;
