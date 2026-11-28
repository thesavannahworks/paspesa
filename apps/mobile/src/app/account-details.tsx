/**
 * Edit the details entered when the account was set up (same layout as setup.tsx).
 * Name and phone can change; past transactions, messages and statements keep their original values.
 * The opening balance is a ledger entry and cannot be edited.
 *
 * Delete account (Data Protection Act 2019 s.26, s.40): online only, in three steps — what happens + the PIN
 * (checked on this device, where it lives), then a 6-digit code emailed to the account's address (checked by
 * the server), then the server deletes the account and this device is cleared.
 */
import { formatAmount, toLocalPhone, updateAccountDetails, verifyPin } from '@paspesa/core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Field, OutlineButton, PrimaryButton, Screen, ScreenHeader, Sheet, T, goBack } from '@/components/ui';
import { ChevronRightIcon, LockIcon } from '@/icons';
import { useApi } from '@/services/api';
import { useAccount, useAppState } from '@/services/AppState';
import { deleteAccountWithCode, messageOf, requestAccountDeletionCode } from '@/services/session';
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const changed = name.trim() !== account.accountName || phone.replace(/\s/g, '') !== toLocalPhone(account.phoneNumber);

  const save = async () => {
    setBusy(true);
    const res = await updateAccountDetails(deps, { accountName: name, phoneNumber: phone });
    setBusy(false);
    if (!res.ok) return setErrors(res.error.fieldErrors ?? { accountName: res.error.message });
    await refresh();
    goBack();
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

      <View style={{ marginTop: s(36), padding: s(16), borderRadius: s(12), borderWidth: 1, borderColor: colors.red }}>
        <T variant="bodyStrong" color={colors.red} style={{ fontSize: s(17) }}>Delete account</T>
        <T variant="body" color={colors.textSecondary} style={{ marginTop: s(8), lineHeight: s(22) }}>
          Permanently delete your Paspesa account and the data in it. This cannot be undone.
        </T>
        <View style={{ marginTop: s(14) }}>
          <OutlineButton danger title="Delete my account" onPress={() => setDeleteOpen(true)} />
        </View>
      </View>

      <DeleteAccountSheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} pinCheck={(pin) => verifyPin(deps, pin)} />
    </Screen>
  );
}

type Step = 'confirm' | 'code';

function DeleteAccountSheet({ visible, onClose, pinCheck }: {
  visible: boolean;
  onClose: () => void;
  pinCheck: (pin: string) => Promise<{ ok: true } | { ok: false; error: { message: string } }>;
}) {
  const { colors } = useTheme();
  const api = useApi();
  const [step, setStep] = useState<Step>('confirm');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const close = () => {
    if (busy) return;
    setStep('confirm');
    setPin('');
    setCode('');
    setError(null);
    onClose();
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = await requestAccountDeletionCode();
      setSentTo(sent.email);
      setResendIn(sent.resendAfterSeconds);
      setStep('code');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!/^\d{4}$/.test(pin)) return setError('Enter your 4-digit Paspesa PIN');
    const checked = await pinCheck(pin);
    if (!checked.ok) return setError(checked.error.message);
    await sendCode();
  };

  const remove = async () => {
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) return setError('Enter the 6-digit code from the email');
    setBusy(true);
    setError(null);
    try {
      await deleteAccountWithCode(code);
      // The device is cleared; the app now shows the sign-in screen with a notice.
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="Delete your account?" onClose={close}>
      {step === 'confirm' ? (
        <View style={{ marginTop: s(10) }}>
          <T variant="body" color={colors.textSecondary} style={{ lineHeight: s(22) }}>When your account is deleted:</T>
          <View style={{ marginTop: s(8) }}>
            {[
              'Your simulated balance, transactions, messages, statements and favourites are erased.',
              'Your email address and sign-in history are erased, and every device is signed out.',
              'Unused Paspesa tokens are forfeited. They are not refunded.',
              'Records of real payments you made to Paspesa (amount, date, M-PESA reference) are kept for our accounts, without your phone number.',
            ].map((line) => (
              <View key={line} style={{ flexDirection: 'row', marginTop: s(6) }}>
                <T variant="body" color={colors.textSecondary} style={{ width: s(16) }}>•</T>
                <T variant="body" color={colors.textSecondary} style={{ flex: 1, lineHeight: s(22) }}>{line}</T>
              </View>
            ))}
          </View>
          {!api.available ? (
            <T variant="body" color={colors.red} style={{ marginTop: s(16), lineHeight: s(22) }}>
              Deleting an account needs the Paspesa server. Connect to the internet and try again.
            </T>
          ) : (
            <>
              <Field label="Enter your Paspesa PIN to continue" value={pin} onChangeText={(v) => { setPin(v.replace(/\D/g, '').slice(0, 4)); setError(null); }}
                placeholder="4 digits" keyboardType="number-pad" secureTextEntry maxLength={4} />
              {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(10) }}>{error}</T> : null}
              <PrimaryButton danger title="Continue" onPress={() => void confirm()} loading={busy} disabled={pin.length !== 4} style={{ marginTop: s(18) }} />
            </>
          )}
        </View>
      ) : (
        <View style={{ marginTop: s(10) }}>
          <T variant="body" color={colors.textSecondary} style={{ lineHeight: s(22) }}>
            We sent a 6-digit code to {sentTo}. Enter it to delete your account for good.
          </T>
          <Field label="Code from the email" value={code} onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); setError(null); }}
            placeholder="000000" keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
          {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(10) }}>{error}</T> : null}
          <PrimaryButton danger title="Delete my account" onPress={() => void remove()} loading={busy} disabled={code.length !== 6} style={{ marginTop: s(18) }} />
          <View style={{ marginTop: s(12) }}>
            <OutlineButton title={resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'} onPress={resendIn > 0 || busy ? undefined : () => void sendCode()} />
          </View>
        </View>
      )}
    </Sheet>
  );
}
