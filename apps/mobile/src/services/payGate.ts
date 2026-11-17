/**
 * Before the PIN: is payment needed for this simulation under the back office's latest settings?
 * Re-reads the settings first (a few seconds at most), so switching payments on in the back office applies
 * even to someone already on the confirm page. Offline, the last known settings decide.
 */
import { quoteSimulation, type Account, type EngineDeps, type SimulationRequest } from '@paspesa/core';
import { useRef, useState } from 'react';
import { checkServerConfig } from './sync';

export function usePayGate(deps: EngineDeps) {
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  /** Resolves true when the pay sheet must be shown before the PIN. */
  const needsPayment = async (account: Account | null, req: Omit<SimulationRequest, 'operationId'>): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setChecking(true);
    try {
      await checkServerConfig();
      const q = account ? quoteSimulation(account, deps.config, req, { ignorePayment: true }) : null;
      return !!q?.ok && deps.config.monetization.paymentRequired && q.quote.pricing.tokenCost > 0;
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  return { checking, needsPayment };
}
