/**
 * Platform ports. The core never touches Date.now(), crypto or storage directly,
 * so the same logic runs on Android, iOS, web and the server, and is fully testable.
 */

export interface Clock {
  /** Current instant as an ISO-8601 string. */
  now(): string;
}

export interface IdGenerator {
  /** Collision-resistant unique ID (UUID v4 or equivalent). */
  uuid(): string;
}

export interface RandomSource {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/**
 * Hashes the simulated Paspesa PIN. Implemented per platform (expo-crypto on device, WebCrypto on web).
 * The PIN is never stored or logged in clear text.
 */
export interface PinHasher {
  hash(pin: string, salt: string): Promise<string>;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };
