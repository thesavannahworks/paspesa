import type { IdGenerator } from './ports';
import type { FieldErrors, OutboxEntry, SimulationError } from './types';

export const PAYLOAD_VERSION = 1;

export type Failure = { ok: false; error: SimulationError };

export function fail(code: SimulationError['code'], message: string, fieldErrors?: FieldErrors, cause?: unknown): Failure {
  if (cause !== undefined) {
    // Diagnostic detail stays in logs; the UI gets a plain message (§39.3).
    console.warn(`[paspesa] ${code}:`, cause);
  }
  return { ok: false, error: fieldErrors ? { code, message, fieldErrors } : { code, message } };
}

/** Deterministic JSON with sorted keys and trimmed strings; empty/undefined values dropped. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(typeof value === 'string' ? value.trim() : value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function outboxEntry(
  ids: IdGenerator,
  installationId: string,
  operationId: string,
  entityType: OutboxEntry['entityType'],
  entityId: string,
  operationType: OutboxEntry['operationType'],
  now: string,
): OutboxEntry {
  return {
    id: ids.uuid(),
    installationId,
    operationId,
    entityType,
    entityId,
    operationType,
    payloadVersion: PAYLOAD_VERSION,
    createdAt: now,
    attemptCount: 0,
    lastAttemptAt: null,
    status: 'PENDING',
    lastError: null,
  };
}

export const PIN_PATTERN = /^\d{4}$/;
