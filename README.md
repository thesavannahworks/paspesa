# Paspesa

Mobile-money transaction simulator with an offline-first ledger, a central transaction engine,
generated messages, history and statements. **Paspesa is a simulator. It does not move real money.**

Product source of truth: [`paspesa white paper v0.3.md`](paspesa%20white%20paper%20v0.3.md) ·
Architecture: [`docs/decisions/0001-initial-architecture.md`](docs/decisions/0001-initial-architecture.md) ·
UI references: [`reference-screenshots/`](reference-screenshots)

## 🚀 Live Deployment

- **Web App:** https://paspesa-mu.vercel.app
- **Backend API:** https://paspesa-production.up.railway.app
- **GitHub:** https://github.com/thesavannahworks/paspesa

### Production Stack

- **Frontend:** Vercel (web app)
- **Backend:** Railway (Node.js)
- **Database:** Neon PostgreSQL (serverless)
- **Email:** SendGrid (authentication codes)
- **Payments:** PayHero (Paspesa Token purchases)

All services run on free tiers.

## Layout

```
packages/core   @paspesa/core — engine, fee schedules, messages, ledger, statements, sync contract (tested)
apps/mobile     @paspesa/mobile — Expo app (Android / iOS / web from one codebase)
apps/backend    @paspesa/backend — NestJS + PostgreSQL: account persistence and synchronization API
```

## Legal Documents

Legal documents are stored as markdown files in `apps/mobile/legal/`:

- **Privacy Policy** (`privacy-policy.md`) - Data collection and usage
- **Terms of Service** (`terms-of-service.md`) - User agreement and acceptable use
- **Data Protection** (`data-protection.md`) - GDPR/Kenya DPA compliance
- **Help & User Guide** (`help.md`) - Complete user documentation
- **About App** (`about.md`) - App information and mission

These are rendered in-app via `/legal/*`, `/help`, and `/about` routes. Users must accept legal terms before signing in.

## Getting started

```bash
npm install                 # once, from the repo root
npm test                    # core business-rule tests
npm run typecheck
```

### Everyday commands (from the repo root)

```bash
npm run dev        # backend + app together: scan the QR code with Expo Go, or press w for the browser
npm run dev:web    # backend + app, opened in the browser
npm run backend    # backend only (http://localhost:3000, back office at /admin)
npm run app        # app only (Expo)
npm run web        # app only, in the browser
npm run admin -- admin:list     # admin commands (see "Run the backend" below)
```

`npm run dev` reuses a backend that is already running, and points the app at it through this computer's
Wi-Fi address so a phone can reach it. A value in `apps/mobile/.env` overrides that. Stop with Ctrl+C.

### Run the app

```bash
cd apps/mobile
npx expo start              # scan the QR code with Expo Go on your phone
npx expo start --web        # or open in a browser at http://localhost:8081
```

- **Phone:** install **Expo Go** from the Play Store / App Store. Your phone and computer must be on the same Wi-Fi.
- **Browser:** use `localhost`. Web Crypto (used to hash the Paspesa PIN) only works on secure origins.

Data is stored on the device (SQLite on the phone, IndexedDB in the browser). It survives restarts.
Clearing app or browser data erases it; the backend (below) keeps a synchronized copy.

### Installable Android app (APK)

Built in the cloud by Expo (a free Expo account is enough); the result is a download link to open on the phone.
The server address is built into the app, so build it once the backend has its public HTTPS address (hosting):

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest env:set --name EXPO_PUBLIC_PASPESA_API_URL --value https://<your-backend> --environment preview --visibility plaintext
npx eas-cli@latest build -p android --profile preview
```

`eas.json` has the profiles: `preview` makes an APK for testers, `production` a Play Store bundle. The Android
package name is `app.paspesa.simulator` (it cannot change once published on the Play Store).

### Run the backend (optional, no cloud host needed)

```bash
npm run dev -w @paspesa/backend     # http://0.0.0.0:3000 — health check: /v1/health
npm test -w @paspesa/backend        # sync API tests (in-memory PostgreSQL)
```

- **Database:** with no configuration it uses an embedded PostgreSQL (PGlite), data in
  `apps/backend/.data/pglite`. To use a real PostgreSQL server (your local PostgreSQL now, a hosted one later),
  create a database and set `DATABASE_URL=postgres://user:password@localhost:5432/paspesa`.
- **Connect the app:** copy `apps/mobile/.env.example` to `apps/mobile/.env`, set
  `EXPO_PUBLIC_PASPESA_API_URL=http://<your computer's Wi-Fi IP>:3000` (or `http://localhost:3000` for the web
  build), then restart `npx expo start --clear`. Profile shows the backup state.
- **Windows firewall:** allow Node.js on private networks the first time, or the phone can't reach port 3000.
- **Back office:** open `http://localhost:3000/admin` (accounts, devices, payments, review queue, pricing,
  fees, settings, audit log, admin users). Create the first administrator once, with the backend stopped
  when using the embedded database:
  `npm run admin -- admin:create you@example.com "Your Name" ADMIN '<10+ chars, letters and numbers>'`.
  Add further users (Administrator, Operator, Viewer) from the Admin users page.
- **Signing in to the app:** with a server configured, the app asks for an email and a 6-digit code the
  first time on each device (and after signing out); then the Paspesa PIN is used as before. To send real
  emails, set the `SMTP_*` settings in `apps/backend/.env` (see `.env.example`; Gmail works with an App
  Password). Without them, codes are printed in the backend's terminal — fine while testing alone.
- **One device at a time per account:** signing in elsewhere (another phone, or the web on a computer)
  moves the account there; the other device uploads what it had, then signs itself out.
- **Back office → My account:** change your name and password, turn on 2-step sign-in with an
  authenticator app (recovery codes included), and see or end your other sessions.
- **Debugging a test session:** `npm run admin -- trace you@example.com` prints that account's recent
  history in order — sign-ins, transactions, uploads, review items and settings changes.
- **Suspending misuse:** Devices and each account page have **Suspend** (with a reason shown to the user)
  and **Reinstate**. A suspended phone or account is blocked until reinstated; nothing is deleted.
- **Uncharged simulations** (stored by the review queue's Apply before the 2026-11-18 fix):
  `npm run admin -- tokens:unpaid you@example.com` lists them; add `--charge` to take their tokens.
- **Admin commands** (scripting; same operations as the back office): `npm run admin -w @paspesa/backend -- help`.
