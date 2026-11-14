import {
  DEFAULT_CONFIG,
  MemoryStore,
  processSimulation as coreProcessSimulation,
  setupAccount,
  type EngineDeps,
  type SimulationRequest,
} from '../src';

export const TEST_PIN = '1234';

/** Deterministic clock: starts at the given instant, advances 1 minute per call. */
export function steppingClock(startIso = '2026-11-14T05:16:00.000Z') {
  let t = Date.parse(startIso);
  return {
    now: () => {
      const iso = new Date(t).toISOString();
      t += 60_000;
      return iso;
    },
    set: (iso: string) => {
      t = Date.parse(iso);
    },
  };
}

export function sequentialIds(prefix = 'id') {
  let n = 0;
  return { uuid: () => `${prefix}-${(++n).toString().padStart(4, '0')}` };
}

/** Pseudo-random but reproducible (LCG). */
export function seededRandom(seed = 42) {
  let s = seed;
  return {
    int: (max: number) => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s % max;
    },
  };
}

/** Test-only hasher (production uses SHA-256 via platform crypto). */
export const fakePinHasher = { hash: async (pin: string, salt: string) => `h(${salt}:${pin})` };

export function makeDeps(overrides: Partial<EngineDeps> = {}) {
  const clock = steppingClock();
  const deps: EngineDeps = {
    store: new MemoryStore(),
    config: DEFAULT_CONFIG,
    clock,
    ids: sequentialIds(),
    random: seededRandom(),
    pinHasher: fakePinHasher,
    installationId: 'install-test',
    ...overrides,
  };
  return { deps, clock, store: deps.store as MemoryStore };
}

export async function makeAccount(openingBalance = 10_000, overrides: Partial<EngineDeps> = {}, startIso?: string) {
  const ctx = makeDeps(overrides);
  if (startIso) ctx.clock.set(startIso);
  const res = await setupAccount(ctx.deps, {
    operationId: 'op-setup',
    accountName: 'Paskal Twoli',
    phoneNumber: '0759981287',
    openingBalance,
    pin: TEST_PIN,
  });
  if (!res.ok) throw new Error(`setup failed: ${res.error.message}`);
  return ctx;
}

/** processSimulation with the correct test PIN unless the request specifies one. */
export function processSimulation(deps: EngineDeps, request: SimulationRequest) {
  return coreProcessSimulation(deps, { pin: TEST_PIN, ...request });
}

let opCounter = 0;
export const newOp = () => `op-${++opCounter}`;
