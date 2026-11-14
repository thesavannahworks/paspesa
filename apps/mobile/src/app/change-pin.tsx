import { setPin } from '@paspesa/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Field, PrimaryButton, Screen, ScreenHeader, T } from '@/components/ui';
import { useAccount, useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/** Set / change the simulated Paspesa PIN. */
export default function ChangePinScreen() {
  const { colors } = useTheme();
  const { deps, refresh } = useAppState();
  const account = useAccount();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const anyPin = deps.config.pinMode === 'ANY_PIN';

  const save = async () => {
    if (next !== confirm) return setError('PINs do not match');
    setBusy(true);
    const res = await setPin(deps, { newPin: next, currentPin: account.pin ? current : undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    await refresh();
    router.back();
  };

  return (
    <Screen footer={<PrimaryButton title="Save PIN" onPress={save} loading={busy} disabled={next.length !== 4 || confirm.length !== 4} />}>
      <ScreenHeader title="Paspesa PIN" />
      <T variant="body" color={colors.textSecondary} style={{ marginTop: 12, lineHeight: 22 }}>
        {anyPin
          ? 'PIN checking is currently switched off by configuration: any 4 digits are accepted. You can still set a PIN for when it is switched on.'
          : 'Your Paspesa PIN confirms simulations. Never use your real M-PESA PIN.'}
      </T>
      {account.pin ? (
        <Field label="Current PIN" value={current} onChangeText={(v) => { setCurrent(digits(v)); setError(null); }} keyboardType="number-pad" secureTextEntry maxLength={4} />
      ) : null}
      <Field label="New PIN" value={next} onChangeText={(v) => { setNext(digits(v)); setError(null); }} keyboardType="number-pad" secureTextEntry maxLength={4} />
      <Field label="Confirm new PIN" value={confirm} onChangeText={(v) => { setConfirm(digits(v)); setError(null); }} keyboardType="number-pad" secureTextEntry maxLength={4} />
      {error ? <T variant="caption" color={colors.red} style={{ marginTop: 14 }}>{error}</T> : null}
    </Screen>
  );
}
