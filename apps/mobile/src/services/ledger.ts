// Type-checking entry. At runtime Metro resolves ledger.native.ts (Android/iOS) or ledger.web.ts (web).
export { openLedgerPersistence } from './ledger.native';
export type { LedgerPersistence } from './ledgerTypes';
