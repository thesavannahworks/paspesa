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
  empty-middle-name double space ("GETRUDE  OHANGA"). Links are display text; tapping one opens the
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
- **Copy / Share / Forward / Select text** append "— Paspesa simulation. Not a real M-PESA message."
  (White Paper §5.1 and §19.2: generated messages must stay identifiable as simulations once they leave
  the app). The Messages header also says "Paspesa simulation". "Add to reminder" is visible but inert.
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
