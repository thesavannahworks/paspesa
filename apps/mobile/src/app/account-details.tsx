/**
 * Edit the details entered when the account was set up (same layout as setup.tsx).
 * Name and phone can change; past transactions, messages and statements keep their original values.
 * The opening balance is a ledger entry and cannot be edited.
 */
import { formatAmount, toLocalPhone, updateAccountDetails } from '@paspesa/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Field, PrimaryButton, Screen, ScreenHeader, T } from '@/components/ui';
import { ChevronRightIcon, LockIcon } from '@/icons';
import { useAccount, useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

export default function AccountDetailsScreen() {
  const { colors } = useTheme();
  const { deps, refresh } = useAppState();
  const account = useAccount();
  const [name, setName] = useState(account.accountName);
  const [phone, setPhone] = useState(toLocalPhone(account.phoneNumber));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== account.accountName || phone.replace(/\s/g, '') !== toLocalPhone(account.phoneNumber);

  const save = async () => {
    setBusy(true);
    const res = await updateAccountDetails(deps, { accountName: name, phoneNumber: phone });
    setBusy(false);
    if (!res.ok) return setErrors(res.error.fieldErrors ?? { accountName: res.error.message });
    await refresh();
    router.back();
  };

  return (
    <Screen footer={<PrimaryButton title="Save changes" onPress={save} loading={busy} disabled={!changed} />}>
      <ScreenHeader title="Account Details" />
      <View style={{ paddingTop: s(16) }}>
        <T variant="amount" style={{ color: colors.green }}>Paspesa</T>
        <T variant="body" color={colors.textSecondary} style={{ marginTop: s(8), lineHeight: s(22) }}>
          Update the details you entered when you set up your account.
        </T>
      </View>
      <Field label="Your name" value={name} onChangeText={(v) => { setName(v); setErrors({}); }} placeholder="Full name" autoCapitalize="words" error={errors.accountName} />
      <Field label="Phone number" value={phone} onChangeText={(v) => { setPhone(v); setErrors({}); }} placeholder="07XX XXX XXX" keyboardType="phone-pad" error={errors.phoneNumber} />
      <Field
        label="Opening balance"
        value={formatAmount(account.openingBalance)}
        editable={false}
        right={<T variant="body">Ksh</T>}
        hint="The opening balance is the first entry in your M-PESA statement, so it can't be changed."
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Change PIN" onPress={() => router.push('/change-pin')}
        style={{ flexDirection: 'row', alignItems: 'center', marginTop: s(26), paddingVertical: s(10) }}>
        <LockIcon size={26} />
        <T variant="body" style={{ flex: 1, marginLeft: s(12), fontSize: s(17) }}>Change PIN</T>
        <ChevronRightIcon size={20} color={colors.textSecondary} />
      </Pressable>
    </Screen>
  );
}
