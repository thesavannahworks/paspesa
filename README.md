# Paspesa

Mobile-money transaction simulator with an offline-first ledger, a central transaction engine,
generated messages, history and statements. **Paspesa is a simulator. It does not move real money.**

Product source of truth: [`paspesa white paper v0.3.md`](paspesa%20white%20paper%20v0.3.md) ·
Architecture: [`docs/decisions/0001-initial-architecture.md`](docs/decisions/0001-initial-architecture.md) ·
UI references: [`reference-screenshots/`](reference-screenshots)

## Layout

```
packages/core   @paspesa/core — engine, fee schedules, messages, ledger, statements (tested)
apps/mobile     @paspesa/mobile — Expo app (Android / iOS / web from one codebase)
```

## Getting started

```bash
npm install                 # once, from the repo root
npm test                    # core business-rule tests
npm run typecheck
```

### Run the app

```bash
cd apps/mobile
npx expo start              # scan the QR code with Expo Go on your phone
npx expo start --web        # or open in a browser at http://localhost:8081
```

- **Phone:** install **Expo Go** from the Play Store / App Store. Your phone and computer must be on the same Wi-Fi.
- **Browser:** use `localhost`. Web Crypto (used to hash the Paspesa PIN) only works on secure origins.

Data is stored on the device (SQLite on the phone, IndexedDB in the browser). It survives restarts.
Clearing app or browser data erases it, until account sync arrives in a later phase.
