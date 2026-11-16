/**
 * Device biometrics (fingerprint / face) for unlocking Paspesa and approving anything that asks for
 * the PIN. The check is done by the phone's OS; Paspesa never sees or stores biometric data.
 * Turning biometrics on requires the PIN first (see app/biometrics.tsx).
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { usePreference } from './preferences';

export const BIOMETRICS_PREF = 'biometricsEnabled';

export type BiometricSupport =
  | { available: true; kind: 'fingerprint' | 'face' | 'biometrics' }
  | { available: false; reason: 'no-hardware' | 'not-enrolled' | 'unsupported' };

/**
 * Development-only hook so browser tests can exercise the flows (the web has no biometric hardware):
 * `window.__paspesaFakeBiometrics = { available: true, succeed: true }`. Ignored in production builds
 * and on phones.
 */
function fake(): { available: boolean; succeed: boolean } | null {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return (window as unknown as { __paspesaFakeBiometrics?: { available: boolean; succeed: boolean } }).__paspesaFakeBiometrics ?? null;
}

export async function biometricSupport(): Promise<BiometricSupport> {
  const f = fake();
  if (f) return f.available ? { available: true, kind: 'fingerprint' } : { available: false, reason: 'not-enrolled' };
  if (Platform.OS === 'web') return { available: false, reason: 'unsupported' };
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return { available: false, reason: 'no-hardware' };
    if (!(await LocalAuthentication.isEnrolledAsync())) return { available: false, reason: 'not-enrolled' };
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const kind = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) ? 'fingerprint'
      : types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? 'face' : 'biometrics';
    return { available: true, kind };
  } catch {
    return { available: false, reason: 'unsupported' };
  }
}

/** Shows the OS biometric prompt. Resolves true only when the owner of the phone was recognised. */
export async function confirmBiometric(promptMessage: string): Promise<boolean> {
  const f = fake();
  if (f) return f.available && f.succeed;
  try {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Use PIN', disableDeviceFallback: true });
    return res.success;
  } catch {
    return false;
  }
}

/** The biometrics setting plus what the phone supports. `active` = turned on AND usable now. */
export function useBiometrics() {
  const [enabled, setEnabled] = usePreference<boolean>(BIOMETRICS_PREF, false);
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  useEffect(() => {
    let live = true;
    void biometricSupport().then((s) => live && setSupport(s));
    return () => {
      live = false;
    };
  }, []);
  return { enabled, setEnabled, support, active: enabled && !!support?.available };
}

export function supportMessage(support: BiometricSupport | null): string | null {
  if (!support || support.available) return null;
  if (support.reason === 'unsupported') return 'Biometrics are available in the Paspesa phone app.';
  if (support.reason === 'no-hardware') return 'This phone has no fingerprint or face unlock.';
  return 'Set up a fingerprint or face unlock in your phone settings first.';
}
