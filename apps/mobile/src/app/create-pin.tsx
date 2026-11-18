import { setPin } from '@paspesa/core';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Field, PrimaryButton, Screen, T } from '@/components/ui';
import { useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/**
 * After signing in on a new device: the account came back from the server, but the PIN never leaves a
 * device, so the user creates one here. Not based on a reference screen.
 */
export default function CreatePinScreen() {
  const { colors } = useTheme();
  const { deps, account, refresh } = useAppState();
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!account) return <Redirect href="/" />;
  if (account.pin) return <Redirect href="/" />;

  const save = async () => {
    if (pin !== confirm) return setError('PINs do not match');
    setBusy(true);
    const res = await setPin(deps, { newPin: pin });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    await refresh();
    router.replace('/');
  };

  return (
    <Screen refreshable={false} footer={<PrimaryButton title="Save PIN" onPress={() => void save()} loading={busy} disabled={pin.length !== 4 || confirm.length !== 4} />}>
      <View style={{ paddingTop: s(32) }}>
        <T variant="amount" style={{ color: colors.green }}>Paspesa</T>
        <T variant="heading" style={{ marginTop: s(18) }}>Welcome back, {account.accountName.split(' ')[0]}</T>
        <T variant="body" color={colors.textSecondary} style={{ marginTop: s(10), lineHeight: s(22) }}>
          Your account, balance and history are on this device now. Create a Paspesa PIN for it — your PIN stays on each device and is never sent anywhere.
        </T>
      </View>
      <Field label="Create Paspesa PIN" value={pin} onChangeText={(v) => { setPinValue(digits(v)); setError(null); }} placeholder="4 digits" keyboardType="number-pad" secureTextEntry maxLength={4} />
      <Field label="Confirm Paspesa PIN" value={confirm} onChangeText={(v) => { setConfirm(digits(v)); setError(null); }} placeholder="4 digits" keyboardType="number-pad" secureTextEntry maxLength={4} />
      <View style={{ marginTop: s(14), padding: s(14), borderRadius: s(10), backgroundColor: colors.greenSoft }}>
        <T variant="caption" color={colors.mode === 'dark' ? '#BFE8C8' : '#1F6B2B'} style={{ lineHeight: s(19) }}>
          This PIN only unlocks simulations in Paspesa. Do not use your real M-PESA PIN — Paspesa will never ask for it.
        </T>
      </View>
      {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(14) }}>{error}</T> : null}
    </Screen>
  );
}
