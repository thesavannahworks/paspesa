// Type-checking entry. At runtime Metro resolves kv.native.ts (Android/iOS) or kv.web.ts (web).
export { openKeyValueStore } from './kv.native';
export type { KeyValueStore } from './kvTypes';
