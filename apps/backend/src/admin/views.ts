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
  const nav = session
    ? html`<nav class="side"><div class="brand">Paspesa <span>Back office</span></div>
        ${NAV.map(([href, label]) => html`<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`)}
        <form method="post" action="/admin/logout" class="logout">${csrf(session)}<button class="link">Sign out</button></form>
      </nav>`
    : html``;
  const who = session ? html`<div class="who"><a href="/admin/me">${session.admin.name}</a> · <b>${session.admin.role}</b></div>` : html``;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Paspesa back office</title><link rel="stylesheet" href="/admin/assets/admin.css"><script src="/admin/assets/admin.js" defer></script></head>
<body class="${session ? 'app' : 'plain'}">${nav.value}<main><header><h1>${esc(title)}</h1>${who.value}</header>${body.value}</main></body></html>`;
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
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.card .k{color:var(--muted);font-size:13px}.card .v{font-size:22px;font-weight:650;margin-top:4px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:13px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--bg);border:1px solid var(--line)}.pill.ok{background:var(--accent-soft);color:var(--accent);border-color:transparent}.pill.bad{background:var(--red-soft);color:var(--red);border-color:transparent}
input.check{width:auto;margin-right:6px}form.inline{display:inline}label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
input,select,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:100%;max-width:420px}
textarea{max-width:640px;min-height:90px;font-family:ui-monospace,monospace;font-size:13px}
button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;margin-top:12px}button.secondary{background:var(--bg);color:var(--text);border:1px solid var(--line)}
button.danger{background:var(--red)}button.link{background:none;color:var(--muted);padding:8px 10px;margin:0}
.notice{padding:10px 12px;border-radius:8px;margin:0 0 16px}.notice.ok{background:var(--accent-soft);color:var(--accent)}.notice.error{background:var(--red-soft);color:var(--red)}
.muted{color:var(--muted)}.row{display:flex;gap:16px;flex-wrap:wrap}.row>*{flex:1;min-width:260px}a{color:var(--accent)}
body.plain main{max-width:380px;margin:12vh auto}
@media (max-width:760px){body.app{grid-template-columns:1fr}.side{position:static;height:auto;flex-direction:row;flex-wrap:wrap}.brand{width:100%}main{padding:16px}}
`;
