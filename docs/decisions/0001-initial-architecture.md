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

## OPEN items
- Default Paspesa recharge sender phone number (placeholder `254700000000`).
- Final message wording and branding (templates are `REFERENCE_DERIVED`; withdraw is `PROVISIONAL`).
- Withdraw journey references.
