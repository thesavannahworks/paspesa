import { parseWholeShillings, setupAccount } from '@paspesa/core';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Field, PrimaryButton, Screen, T } from '@/components/ui';
import { useAppState } from '@/services/AppState';
import { useSubmission } from '@/services/useSubmission';
import { useTheme } from '@/theme/ThemeProvider';

/** Account setup with opening balance (White Paper §10.1). Not based on a reference screen. */
export default function SetupScreen() {
  const { colors } = useTheme();
  const { deps, account, refresh } = useAppState();
  const submission = useSubmission();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [opening, setOpening] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const needsPin = deps.config.pinMode === 'USER_PIN';

  if (account) return <Redirect href="/" />;

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    submission.reset(); // details changed → this is a new operation
  };

  const submit = async () => {
    const amount = opening.trim() === '' ? 0 : parseWholeShillings(opening);
    const local: Record<string, string> = {};
    if (amount === null) local.openingBalance = 'Enter an amount in whole shillings';
    if (needsPin && pin !== pin2) local.pin2 = 'PINs do not match';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const res = await submission.run((operationId) =>
      setupAccount(deps, { operationId, accountName: name, phoneNumber: phone, openingBalance: amount!, pin: needsPin ? pin : undefined }),
    );
    if (!res.ok) {
      setErrors(res.error.fieldErrors ?? {});
      setFormError(res.error.fieldErrors ? null : res.error.message);
      return;
    }
    await refresh();
    router.replace('/');
  };

  return (
    <Screen footer={<PrimaryButton title="Create account" onPress={submit} loading={submission.busy} />}>
      <View style={{ paddingTop: 32 }}>
        <T variant="amount" style={{ color: colors.green }}>Paspesa</T>
        <T variant="body" color={colors.textSecondary} style={{ marginTop: 8, lineHeight: 22 }}>
          Set up your simulated account. Balances, transactions and messages in Paspesa are simulations — not real money.
        </T>
      </View>
      <Field label="Your name" value={name} onChangeText={edit(setName)} placeholder="e.g. Paskal Twoli" autoCapitalize="words" error={errors.accountName} />
      <Field label="Phone number" value={phone} onChangeText={edit(setPhone)} placeholder="07XX XXX XXX" keyboardType="phone-pad" error={errors.phoneNumber} />
      <Field
        label="Opening balance"
        value={opening}
        onChangeText={edit(setOpening)}
        placeholder="0"
        keyboardType="number-pad"
        right={<T variant="body">Ksh</T>}
        hint={`Simulated starting balance, up to Ksh ${deps.config.maxOpeningBalance.toLocaleString('en-US')}`}
        error={errors.openingBalance}
      />
      {needsPin ? (
        <>
          <Field label="Create Paspesa PIN" value={pin} onChangeText={edit((v) => setPin(v.replace(/\D/g, '').slice(0, 4)))} placeholder="4 digits" keyboardType="number-pad" secureTextEntry maxLength={4} error={errors.pin} />
          <Field label="Confirm Paspesa PIN" value={pin2} onChangeText={(v) => setPin2(v.replace(/\D/g, '').slice(0, 4))} placeholder="4 digits" keyboardType="number-pad" secureTextEntry maxLength={4} error={errors.pin2} />
          <View style={{ marginTop: 14, padding: 14, borderRadius: 10, backgroundColor: colors.greenSoft }}>
            <T variant="caption" color={colors.mode === 'dark' ? '#BFE8C8' : '#1F6B2B'} style={{ lineHeight: 19 }}>
              This PIN only unlocks simulations in Paspesa. Do not use your real M-PESA PIN — Paspesa will never ask for it.
            </T>
          </View>
        </>
      ) : null}
      {formError ? <T variant="caption" color={colors.red} style={{ marginTop: 14 }}>{formError}</T> : null}
    </Screen>
  );
}
