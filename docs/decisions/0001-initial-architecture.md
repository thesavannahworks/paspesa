# ADR 0001 — Initial architecture

**Date:** 2026-11-14 · **Status:** Accepted (stack) / Proposed (items marked OPEN)

## Context
The repository started empty apart from White Paper v0.3 and the reference screenshots, so
the White Paper §7 direction could be adopted without restructuring anything.

Product-owner decisions (2026-11-14): mobile first, but the web build must work for testing;
whole shillings only; KSh 250,000 maximum; Airtime fee KSh 0; opening balance is its own
ledger entry shown on statements; simulations are free (`UNMETERED`) until the monetization phase.

## Decisions
| Area | Choice | Why |
|---|---|---|
| Repo | npm workspaces monorepo (`packages/*`, `apps/*`) | pnpm is not installed; npm workspaces work with Expo/Metro without symlink workarounds |
| Shared logic | `@paspesa/core` (TypeScript, no platform deps) | One engine, fee, message and statement implementation for all clients and the backend |
| Mobile + web client | Expo (React Native) with the web target from the same codebase | Mobile first; the same app runs in a browser for testing |
| Local DB | `LocalStore` port. SQLite on device, IndexedDB on web | Offline-first; `runAtomic` gives all-or-nothing writes on both |
| Backend | NestJS + PostgreSQL (Phase 5) | White Paper §7 |
| Tests | Vitest | Fast, TypeScript-native |
| Time | Fixed EAT (UTC+3) offset in core | Identical formatting on Hermes, browsers and the server |

## Engine invariants (enforced in `packages/core/src/engine.ts`)
1. A single atomic unit writes the transaction, balance movement, message, account balance and outbox entry.
2. The client generates `operationId` once and reuses it on every retry. A repeat returns the original result. If the same ID arrives with a different payload, the result is `OPERATION_CONFLICT`.
3. `quoteSimulation` is the only fee and balance calculation. The confirmation screen and the commit both use it.
4. A message is rendered only from the committed record.
5. Balance = sum of movements (the opening balance is the first movement). `reconcileAccount` verifies this.
6. Each record stores the fee schedule ID and version, so later tariff changes never rewrite history.

## Local persistence (v1)
The app keeps the local ledger in a `MemoryStore` and persists the **complete committed state as one
document** after each atomic unit, before the change becomes visible:
- Android/iOS: `expo-sqlite` (`paspesa.db`, table `kv`), single `INSERT OR REPLACE`.
- Web: IndexedDB (`paspesa` / `kv`); the write resolves on transaction `complete`.

If the save fails, the unit rolls back and the engine reports `STORAGE_FAILURE`. Retrying with the same `operationId` is then safe.
This keeps commits truly atomic on both platforms with very little code. **Known limit:** each save
rewrites the whole ledger, which is fine for thousands of records but should be replaced by a
table-per-entity SQLite/IndexedDB adapter (same `LocalStore` port) before heavy usage.
Web avoids `expo-sqlite` because it requires COOP/COEP headers (SharedArrayBuffer).

## OPEN items
- Default Paspesa recharge sender phone number (placeholder `254700000000`).
- Final message wording and branding (templates are `REFERENCE_DERIVED`; withdraw is `PROVISIONAL`).
- Withdraw journey references.

## UI sizing
The reference app scales its layout with screen width. All sizes in the app are calibrated against the
screenshots at 540 dp (`apps/mobile/src/theme/scale.ts`, `REFERENCE_WIDTH`) and scaled by `s()` to the
device width, so a phone shows the same proportions as the references.
Text does not grow with the phone's system font-size setting (`FIXED_TEXT`), matching the reference app:
measured on the owner's phone, reference text stayed at its size while ours grew 10%. Sizes and weights
were then measured element by element against the screenshots (same 1080 px phone, 2 px per unit).

## Scan to Pay, profile picture, Explore (2026-11-16)
- **QR codes:** Paspesa's own format `paspesa://pay?v=1&t=<type>&…` (`packages/core/src/qr.ts`, tested).
  Superseded 2026-11-16 (owner request): M-PESA codes are now accepted too (see below). Scanning works from the
  live camera, a captured photo or a gallery image, and opens the matching journey pre-filled.
- **My QR download:** phone saves a PNG to the gallery; the browser downloads an SVG of the code.
- **Profile picture:** stored on the device only (document folder on phone, data URI in the browser);
  it is not part of the ledger and is not synced.
- **Explore banners:** Paspesa's own artwork. The supplied third-party adverts are kept in
  `reference-screenshots/01-home/12-14` as references only (White Paper §40).

## Messages, transaction codes, M-PESA QR (2026-11-16)
- **Templates** (`packages/core/src/messages/templates.ts`) copy the supplied messages character for
  character, including their irregular spacing and trailing links. Two-part names print with M-PESA's
  empty-middle-name double space ("PETER  KAMAU"). Links are display text; tapping one opens the
  Paspesa home screen. Not simulated (no Paspesa feature): Ziidi round-ups, Fuliza, Shiriki Pay,
  bundles, mini-statements, Safaricom's own "Safaricom Offers" paybill variant, and the
  "similar transaction is currently underway" notice (duplicate submissions are idempotent instead).
- **"Amount you can transact within the day"** = 500,000 less the day's payments (fees excluded),
  matching the references. Display only; Paspesa still has no daily limit.
- **Wrong PIN** is logged in Messages: the short notice first, then the "Failed, … *334#" notice for a
  further wrong PIN on the same payment. These are SYSTEM_NOTICE messages with no transaction.
- **Deleting messages** (single from the menu, bulk from the trash button) only hides messages
  (`deletedAt`). Transactions and the M-PESA statement are never touched; changing statements stays an
  admin back-office operation.
- **Copy / Share / Forward / Select text** send the message exactly as shown. The owner removed the
  simulation tags (header, statement footer, copied-text ending) on 2026-11-17 so screens match the
  references. "Add to reminder" is visible but inert.
- **Transaction codes** (`packages/core/src/reference.ts`): date prefix + node ("LA" for the account
  holder's own payments, the sender's node for money received) + a base-36 counter that rises with
  time, fitted to the 44 reference codes (≈ 2.41 per second, ±1 hour scatter). Codes generated now sit
  next to real codes issued at the same moment.
- **M-PESA QR:** EMVCo merchant-presented payloads (tag 00 = 01, currency 404, country KE; the M-PESA
  template in 26–51, name in 59, amount in 54, account in 62) and the Daraja key/value form
  (TrxCode/CPI/Amount). The decoded till, paybill or phone only pre-fills a simulated payment
  (White Paper §5.1). The exact tag layout of Safaricom's codes is not publicly documented, so the
  parser is tolerant; verify against a real code when available.
- **Transaction detail** follows the 2026-11 references: "Phone Number" holds the phone, till or paybill;
  the time is 24-hour with an am/pm suffix ("21:54pm"); the category chip toggles the Transaction Fee row.

## Biometrics, app unlock, editable account details (2026-11-17)
- **Biometrics** (`expo-local-authentication`; reference 02-profile-settings/06): turning on requires the
  PIN, then the phone's biometric check. When on, the app opens locked (and locks again after more than
  a minute in the background) and every PIN page opens the biometric prompt at once, with a fingerprint
  key in the keypad and the PIN as fallback. Turning off needs no PIN. The OS does the check; Paspesa
  never sees biometric data. A biometric approval reaches the engine as `authMethod: 'BIOMETRIC'`
  instead of a PIN — a future backend must treat this as a device assertion.
- The PIN page title is "Enter M-PESA PIN" (owner decision); setup and change-PIN still say "Paspesa
  PIN" and warn never to use the real M-PESA PIN.
- **Account details** (Profile → Account Details): name and phone from setup can be edited. Past
  transactions, messages and statements keep their original values. The opening balance is read-only
  because it is the first ledger entry.

## Local storage in tables (2026-11-17)
- The ledger is stored per entity, not as one JSON record: SQLite tables in `paspesa.db` on the phone,
  IndexedDB object stores (database `paspesa` v2) in the browser (White Paper §7, §23.2).
- The engine still works on an in-memory copy (fast reads, all-or-nothing units). Each committed unit
  now produces a change set — only the rows it touched — written in ONE database transaction
  before the change becomes visible (`MemoryStore` option `persistChanges`, `packages/core/src/changes.ts`).
- The SQL schema and statements are platform-neutral (`packages/core/src/sqlLedger.ts`): the phone runs
  them through expo-sqlite (`withExclusiveTransactionAsync`), the tests through Node's built-in SQLite.
  UNIQUE constraints on operation ID, reference, sequence, one movement / one confirmation message per
  transaction and one outbox entry per operation give duplicate protection in the database itself (§25).
  Records are kept whole as JSON beside the indexed columns, so new optional fields need no migration.
- Migration: on first start the old single record (`ledger.state.v1`) is written to the tables in one
  transaction and removed only afterwards; an interrupted migration just repeats the removal.

## Backend and synchronization (2026-11-17)
- **Stack:** NestJS 12 (ES modules, run with `tsx`) + PostgreSQL, as proposed by the White Paper (owner
  confirmed). No cloud host yet (owner decision): it runs on a developer machine. With no `DATABASE_URL` it
  uses PGlite — the PostgreSQL engine embedded in Node — so nothing has to be installed; the same SQL runs on
  a real PostgreSQL server. Dependencies are injected by explicit token (no decorator metadata), so the tests
  run on Vitest like core.
- **Identity (§24.5):** anonymous installation. The device creates a random secret and registers it with its
  installation ID; the server keeps only the SHA-256 hash. Registration is idempotent (retry-safe).
- **Contract** (`packages/core/src/sync.ts`, shared by app and server): `POST /v1/sync/push` carries outbox
  operations (CREATE_ACCOUNT, CREATE_SIMULATION, UPDATE_ACCOUNT_SETTINGS, UPSERT/DELETE_FAVOURITE); each gets
  SYNCED or NEEDS_REVIEW with a code. `GET /v1/sync/state` and `/v1/sync/pull` support reconciliation (§25.4).
- **Server authority (§39.1):** balances are never taken from the phone. Each transaction is recomputed with
  the shared engine (`checkSyncedTransaction`): it must follow the account's last position and match the
  fee, amount and balances. Settings travel as explicit changes captured when they happened (outbox
  `payload`), e.g. an airtime reset must clear exactly the server's airtime balance.
- **Idempotency (§24.2, §25):** each operation is processed once per installation (`sync_operations`,
  fingerprinted on its immutable content). A retry returns the stored verdict (DUPLICATE); the same ID with
  different content is an OPERATION_CONFLICT. One database transaction per operation, serialized per
  installation with an advisory lock.
- **Never silently dropped (§24.4):** failed checks go to `sync_review` and the phone marks the records
  NEEDS_REVIEW; nothing is applied. Settings changes are written to `audit_log` (§37.15).
- **Not uploaded:** the simulated PIN (only "PIN changed" is recorded), wrong-PIN notices, and message
  read/star/delete state — they stay on the device.
- **App:** sync is off unless `EXPO_PUBLIC_PASPESA_API_URL` is set. It uploads on start, ~1.5 s after each
  new local change, on returning to the foreground and every minute; failures leave everything queued.
  Profile shows the backup state.
- **Later:** multi-device download (pull is in place; applying it on a second device comes with
  registration), admin review of `sync_review`, deployment to a host.

## Monetization foundation — Phase 6 (2026-11-17)
Built, not switched on: simulations stay UNMETERED (owner decision) and the app is unchanged until
activation, which needs the product-owner inputs listed below (§52).
- **Pricing engine** (`packages/core/src/pricing.ts`): FULL_AMOUNT (default: free up to KSh 20, KSh 5 per
  token), EXCESS_AMOUNT and TIERED (validated: contiguous ranges from KSh 0). Precedence account+type →
  account → global type → global. Each price comes with the snapshot to store (§27.5). Rule changes are new
  versions (old ones kept, the previous one ends at the new effective date) and are audited.
- **Token wallet** (`packages/core/src/tokens.ts`, server tables `token_wallets/lots/ledger/spends`): one
  wallet per account; grant lots per credit (idempotent per source reference; purchased tokens never
  expire); spend order promotional → admin → purchased, within a category the lot expiring first; one
  spend per simulation (retries return it); reversal restores the exact lots as separate entries; expiry is
  a permanent entry per lot with its original grant; balance caches are recomputed in the same transaction
  and `reconcile` checks lots against the ledger. Wallet rows are locked per operation (no overspending).
- **Payments** (`packages/core/src/payments.ts`, tables `payments`, `payment_events`, `payment_credits`):
  token purchase and direct pay-per-simulation records with separate payment / simulation / refund states.
  Idempotent on the client's key; a provider callback is never trusted alone — status is verified with the
  provider; a timeout keeps the payment PENDING; tokens are credited once from a verified purchase; a direct
  payment authorizes its simulation only when verified; a paid simulation that fails gets a refundable
  credit (the §33 mechanism chosen until a provider is picked). No provider is connected; tests use a sandbox.
- **API:** read-only `GET /v1/pricing`, `POST /v1/pricing/quote`, `GET /v1/wallet`. Changes go through the
  server admin CLI (`npm run admin -w @paspesa/backend`) until the admin back office has administrator login.
- **Owner decisions (2026-11-17), not in White Paper v0.3:** 1 token = KSh 1 — pay-per-simulation costs
  the token cost in shillings (KSh 100 simulation → 20 tokens → KSh 20) and buying tokens is "pay KSh N, get
  N tokens" (no fixed packages; the token-package table was removed). Recharge is never priced (charging is
  per transaction simulation). Free simulations may run offline, as a back-office setting
  (`freeSimulationsOffline`, with `paymentRequired` off until activation) delivered with `GET /v1/pricing`.
- **Payment provider:** M-PESA STK Push through Safaricom Daraja (`apps/backend/src/mpesa.ts`), configured
  only by backend environment (`MPESA_*`, see `apps/backend/.env.example`). Daraja sandbox keys are free and
  immediate; going live needs a Paybill/Till and Safaricom's go-live approval (or an aggregator — the
  provider is pluggable). Status is confirmed with the STK Query API; callbacks only trigger that check.
- **Several providers side by side (owner request, to compare before choosing):** Daraja, Kopo Kopo,
  IntaSend, Paystack (M-PESA mobile money) and PayHero adapters (`apps/backend/src/providers.ts`). Each is
  switched on by its own environment keys; a purchase may name one, else `PAYMENT_PROVIDER` / the first
  configured. `GET /v1/payments/providers` lists them. Built from public docs; details the docs did not
  confirm (Kopo Kopo production URL, IntaSend status path, PayHero status endpoint) are marked unverified
  and overridable by `*_BASE_URL`. Live testing with real keys is deferred by the owner.
- **Still open:** live provider route (own shortcode vs aggregator); device allocations for offline token
  use (Phase 7).

## Device token allocations — Phase 7, part 1 (2026-11-17)
- **Reservation model** (`apps/backend/src/allocation.service.ts`): a device's allocation RESERVES tokens
  inside their grant lots (`token_lots.reserved_quantity`, `allocation_lots`), so categories and the
  promotional → admin → purchased order survive. Central spending and expiry use only the unreserved part.
  DEVICE_ALLOCATION / DEVICE_RELEASE ledger lines record reservations without changing a lot's balance;
  expenditure from an allocation and LOST_DEVICE_FORFEITURE do. Reconciliation checks both: lots against
  the ledger, and reserved quantities against active allocations. One active allocation per device.
- **Offline authorization:** an allocation carries an authorization window (`offlineAuthorizationDays`,
  default 3, back-office setting) and the pricing configuration to use offline (§27.6). Every sync renews
  both. After the window, the device cannot start paid token simulations; earlier records still reconcile
  and the allocation is not returned automatically (§29.4).
- **Engine:** `paymentMethod` per simulation — TOKENS (from the device allocation, works offline), DIRECT
  (needs a verified payment id), UNMETERED (free while `paymentRequired` is off, or for 0-token
  simulations; with `freeSimulationsOffline` off a free simulation needs an authorized device). Paid
  records store their pricing snapshot. Free play never depends on pricing being available.
- **Sync:** uploaded TOKENS records are re-priced with the allocation's pricing and spent from its lots
  (once per simulation); a mismatch is PRICING_MISMATCH for review. DIRECT records must match a verified
  payment for that simulation. UNMETERED priced records are rejected only while payments are required.
- **Release** (online) returns unused tokens only when the phone's remaining equals the server's (all
  spending uploaded). **Lost device** (admin CLI `device:lost`) forfeits every unreconciled reserved token
  as a permanent, audited ledger event; no transactions are invented.
- **Limit:** one installation per account today, so "Phone B" (§29.2) arrives with account registration
  and login; the allocation model is already per device.

## Pay sheet, token pages, back office (2026-11-17)
- **Pay sheet:** when payments are required and a simulation costs tokens, Confirm opens a bottom sheet
  ("choose how to pay") before the PIN: Paspesa Tokens (shows what is set aside on the phone) or M-PESA
  (STK prompt for the token cost in KSh, polled until verified). Free simulations go straight to the PIN.
- **Token pages:** Profile → Paspesa Tokens: balances, tokens on this phone (set aside / return), buy
  tokens, purchase and spending history.
- **Back office** (`apps/backend/src/admin/`, served by the backend at `/admin`): server-rendered HTML
  forms, no JavaScript; CSP `default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'`.
  - **Login:** email + password (scrypt, per-user salt), 5 failures lock for 15 minutes, the same message
    for unknown email and wrong password. Session token in an HttpOnly, SameSite=Strict cookie scoped to
    `/admin`; only its SHA-256 is stored; 8 hours. Each session has a CSRF token required on every form.
  - **Roles, enforced on the server:** Viewer (read only), Operator (+ promotional grants, verify payments,
    resolve review items, mark devices lost), Administrator (+ administrator-issued tokens, pricing,
    settings, admin users). Disabling a user ends their sessions.
  - **Pages:** dashboard (§35.8 counts), accounts (search, wallet, ledger, reconciliation, simulations,
    grants), devices (allocations, mark lost with confirmation), payments (filter, verify now, refundable
    credits), review queue (resolve with a note), pricing (publish a new rule version: full, excess,
    tiered), fees (read only for now — schedules still live in core config), settings, audit log.
  - Every change is audited as `admin:<email>` with a reason where the action needs one.
  - The first administrator is created with the CLI (`admin:create`); there is no default password.
- **Still open:** editing fee schedules centrally; 2-factor sign-in once the back office is hosted.

## Account sign-in, one active device, admin 2-step sign-in (2026-11-17)
- **Sign-in (owner decision):** email + 6-digit code; required the first time on a device and after
  signing out, then the Paspesa PIN as before. Only when a server is configured (offline-only builds skip it).
  Codes: 10 minutes, 5 tries, salted hash stored, one a minute and 10 a day per email (20 per device);
  the answer never reveals whether an email has an account. Email via SMTP (`SMTP_*`), printed to the
  console when not configured.
- **One active device per account:** transactions are numbered on the device that records them, so two
  devices recording at once would collide. Signing in elsewhere moves the account (`accounts.installation_id`
  = active device, `installations.account_id` = the account a device works on). The old device may still
  upload operations it recorded before the move (later ones go to review as SIGNED_OUT); it learns it was
  signed out from the push response or `/v1/auth/me`, returns tokens set aside on it, and wipes itself.
- **Restore:** a device that signs in to an existing account downloads it (`/v1/account/restore`):
  transactions, confirmation messages (as read), favourites; the balance is re-derived and must match.
  The PIN never leaves a device (people reuse real PINs), so the new device creates one.
- **Conflict:** a device with its own account signing in with an email that already owns another account
  must choose to switch (its own account stays on the server, without a device).
- **Sign-out (Profile):** uploads first; if something can't be uploaded (offline) it says so and offers
  "sign out anyway". Clears the ledger, the profile photo and biometrics on the device.
- **Back office — My account:** name, password change (current password required; signs out other
  sessions), optional 2-step sign-in with an authenticator app (TOTP, RFC 6238; QR + setup key; 10
  one-time recovery codes stored hashed; reuse of a code refused), sessions list with "sign out everywhere
  else". Administrators can reset another admin's 2-step sign-in (lost phone). All audited.
- **Still open:** requiring 2-step sign-in for every admin once hosted; changing an account's email.

## Review queue, settings history, web layout (2026-11-18)
- **Bug fixed:** an offline simulation recorded while payments were off was refused (PAYMENT_REQUIRED) if
  payments were switched on before it uploaded. The server now keeps every version of the monetization
  settings (`monetization_settings_history`, seeded from the audit log) and judges an upload by the
  settings in force when the simulation happened (a future device time counts as now).
- **Moved accounts:** once an account moves to another device, the old device's uploads are all kept for
  review (SIGNED_OUT) — the new device continued from the server's ledger, so accepting them would put it
  out of step. Tokens set aside on the old device are all returned when it releases them.
- **No cascades:** simulations are numbered, so while one is held for review the later ones cannot fit.
  The device holds them back, and the server hands back (HELD) later simulations of the same upload.
- **Review actions:** Apply (stores a held simulation without charging, only when it is still the next
  transaction from the server's balance) or Dismiss (with a note). Each code has a plain explanation.
  The device learns outcomes from `GET /v1/sync/state` (`reviewed`); after a dismissal it is "out of step"
  and Profile offers Reload from backup (keeps the PIN and tokens set aside).
- **App:** pull down to back up and refresh (phones); "Back up now" in Profile and the web sidebar.
  Sign-out uploads only if something is waiting (≤ 10 s), then tells the server and returns tokens in
  parallel (≤ 5 s each).
- **Web on a computer:** screens keep their phone design in a centred 540 px column from 640 px wide; a
  sidebar (main places, name, backup status) from 1,000 px. Pop-ups stay over the column. Phones unchanged.
- **Debugging:** `npm run admin -- trace <email|phone|accountId> [hours]` prints an account's recent
  history (sign-ins, transactions, uploads, review items, settings changes); `review:list`.

## Tokens online, sign-in switching, Android refresh fix (2026-11-18)
- **Owner rule:** tokens set aside on a device are only for offline use. Online with nothing (enough) set
  aside, a paid simulation is paid from the central balance: payment method WALLET. The pay sheet shows
  the central balance (less WALLET simulations not uploaded yet); the server re-prices and deducts it when
  the record uploads, in the same transaction; not enough left → review (INSUFFICIENT_TOKENS).
- **Sign-out** detaches the device from its account on the server; an account that moved to another
  device no longer counts as held by the old one. Switching a device to another email (that has no
  account) clears the old account from the device; it stays on the server for its own email.
- **Android blank home:** the pull-to-refresh control must pass the ScrollView's children and style
  through (Android and web wrap the scroll content inside the refresh control).


## Combined tokens, review charging fix, suspensions, phone frame (2026-11-18)
- **Bug fixed — tokens came back after Apply:** applying a held simulation in the review queue stored it
  without taking its tokens, so the server still counted them as set aside on the phone; the phone adopted
  the server's figure and Return gave them back. Apply now charges every token-paid simulation (this
  device's set-aside tokens first, then the central balance; refused if neither covers it). Only the
  "payment required" rule for unpaid simulations and an unverified direct payment can be waived.
  `npm run admin -- tokens:unpaid <email> [--charge]` finds (and, when told to, charges) records stored by
  the old behaviour.
- **Owner rule — all tokens count:** online, a simulation may be paid partly from the phone's set-aside
  tokens and partly from the central balance (`paymentMethod: TOKENS` + `centralTokens`). Default: the
  phone's first, the balance fills the gap; the order is a per-device preference on the Paspesa Tokens page
  ("This phone first" / "Your balance first"). Offline only the phone's count. The server checks both
  parts before deducting anything, so a refusal leaves no partial charge.
- **Pay per simulation:** the M-PESA prompt can go to any number the user types (their own by default).
- **Suspensions (reversible):** back office (Operator, Admin) can suspend a device or an account with a
  reason and reinstate it later; both are audited. A suspended device gets 403 DEVICE_SUSPENDED on every
  request; a suspended account's email cannot sign in and its device gets 403 ACCOUNT_SUSPENDED except on
  /v1/auth/* (so it can sign out and use another email). The app shows a blocking screen, remembered
  offline, that lifts on the first request that goes through. Nothing is deleted.
- **Web on a computer:** the app is drawn inside a Samsung Galaxy-style phone (bezel, punch-hole camera,
  status bar, side keys) at the owner's phone size, 540 × 1141, scaled evenly to fit the window; pop-ups
  stay inside the phone; the sidebar is unchanged.
- **Test data:** tests and placeholders no longer use the owner's or reference-screenshot names and numbers.
