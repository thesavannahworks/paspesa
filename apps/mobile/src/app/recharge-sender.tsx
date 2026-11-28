import { toLocalPhone, updateRechargeSenderDefaults } from '@paspesa/core';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Field, PrimaryButton, Screen, ScreenHeader, T, goBack } from '@/components/ui';
import { useAccount, useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

/** User-configurable default sender for recharges (owner decision: not only back office). */
export default function RechargeSenderScreen() {
  const { colors } = useTheme();
  const { deps, refresh } = useAppState();
  const account = useAccount();
  const current = account.rechargeSenderDefaults ?? deps.config.defaultRechargeSender;
  const [name, setName] = useState(current.name);
  const [phone, setPhone] = useState(toLocalPhone(current.phone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async (value: { name: string; phone: string } | null) => {
    setBusy(true);
    const res = await updateRechargeSenderDefaults(deps, value);
    setBusy(false);
    if (!res.ok) {
      setErrors(res.error.fieldErrors ?? {});
      return;
    }
    await refresh();
    goBack();
  };

  return (
    <Screen footer={<PrimaryButton title="Save" onPress={() => save({ name, phone })} loading={busy} />}>
      <ScreenHeader title="Default Sender" />
      <T variant="body" color={colors.textSecondary} style={{ marginTop: s(12), lineHeight: s(22) }}>
        Used for recharges when you don&apos;t enter a custom sender.
      </T>
      <Field label="Sender name" value={name} onChangeText={(v) => { setName(v); setErrors({}); }} autoCapitalize="words" error={errors.name} />
      <Field label="Sender phone number" value={phone} onChangeText={(v) => { setPhone(v); setErrors({}); }} keyboardType="phone-pad" error={errors.phone} />
      {account.rechargeSenderDefaults ? (
        <Pressable accessibilityRole="button" onPress={() => save(null)} style={{ marginTop: s(24) }}>
          <T variant="body" color={colors.green}>Restore Paspesa default ({deps.config.defaultRechargeSender.name} · {toLocalPhone(deps.config.defaultRechargeSender.phone)})</T>
        </Pressable>
      ) : null}
    </Screen>
  );
}
