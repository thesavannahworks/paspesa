/**
 * Minimal durable key–value storage. Each `set` is a single atomic write
 * (one SQLite statement on device, one IndexedDB put on web).
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
