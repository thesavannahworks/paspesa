/**
 * App unlock. When biometrics are turned on, Paspesa opens locked: the phone's biometric prompt
 * appears at once, with the PIN as the fallback. It locks again after being in the background for
 * more than a minute (a shorter absence, e.g. picking a photo or a contact, does not lock it).
 */
import { verifyPin } from '@paspesa/core';
import { useEffect, useRef, useState } from 'react';
import { AppState, Modal } from 'react-native';
import { PinView, type PinAuth } from '@/components/journey';
import { UserAvatar } from '@/components/UserAvatar';
import { useAppState } from '@/services/AppState';
import { useBiometrics } from '@/services/biometrics';

const LOCK_AFTER_MS = 60_000;

export function AppLock() {
  const { account, deps } = useAppState();
  const { enabled } = useBiometrics();
  const [locked, setLocked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const awayAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') awayAt.current = Date.now();
      else if (state === 'active' && awayAt.current !== null) {
        const away = Date.now() - awayAt.current;
        awayAt.current = null;
        if (enabled && away > LOCK_AFTER_MS) {
          setError(null);
          setLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, [enabled]);

  if (!locked || !enabled || !account) return null;

  const onSubmit = async (auth: PinAuth) => {
    if ('pin' in auth) {
      const res = await verifyPin(deps, auth.pin);
      if (!res.ok) return setError(res.error.message);
    }
    setError(null);
    setLocked(false);
  };

  return (
    <Modal visible animationType="none" onRequestClose={() => undefined}>
      <PinView
        badge={<UserAvatar size={79} fontSize={16.5} />}
        name={account.accountName}
        biometricPrompt="Unlock Paspesa"
        onSubmit={onSubmit}
        error={error}
      />
    </Modal>
  );
}
