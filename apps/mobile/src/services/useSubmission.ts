import * as Crypto from 'expo-crypto';
import { useCallback, useRef, useState } from 'react';

/**
 * Idempotent submission (White Paper §25.2): the operation ID is generated once, the first time
 * the user submits, and reused for every retry of that same operation. A new ID is only created
 * after `reset()` (e.g. the user edited the details or started a new operation).
 */
export function useSubmission() {
  const opId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);

  const operationId = useCallback(() => {
    if (!opId.current) opId.current = Crypto.randomUUID();
    return opId.current;
  }, []);

  const reset = useCallback(() => {
    opId.current = null;
  }, []);

  const run = useCallback(async <T,>(work: (operationId: string) => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await work(operationId());
    } finally {
      setBusy(false);
    }
  }, [operationId]);

  return { run, reset, busy };
}
