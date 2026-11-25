/**
 * Edit the details entered when the account was set up (same layout as setup.tsx).
 * Name and phone can change; past transactions, messages and statements keep their original values.
 * The opening balance is a ledger entry and cannot be edited.
 */
import { deleteAccount, formatAmount, toLocalPhone, updateAccountDetails } from '@paspesa/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { AppModal as Modal } from '@/components/LayoutFrame';
import { Field, OutlineButton, PrimaryButton, Screen, ScreenHeader, T } from '@/components/ui';
import { ChevronRightIcon, LockIcon } from '@/icons';
import { useAccount, useAppState } from '@/services/AppState';
import { useApi } from '@/services/api';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

export default function AccountDetailsScreen() {
  const { colors } = useTheme();
  const { deps, refresh } = useAppState();
  const account = useAccount();
  const api = useApi();
  const [name, setName] = useState(account.accountName);
  const [phone, setPhone] = useState(toLocalPhone(account.phoneNumber));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pin, setPin] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const changed = name.trim() !== account.accountName || phone.replace(/\s/g, '') !== toLocalPhone(account.phoneNumber);

  const save = async () => {
    setBusy(true);
    const res = await updateAccountDetails(deps, { accountName: name, phoneNumber: phone });
    setBusy(false);
    if (!res.ok) return setErrors(res.error.fieldErrors ?? { accountName: res.error.message });
    await refresh();
    router.back();
  };

  const handleDeleteRequest = () => {
    setPin('');
    setDeleteError('');
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!pin || pin.length !== 4) {
      setDeleteError('Enter your 4-digit PIN');
      return;
    }

    setDeleting(true);
    setDeleteError('');

    // Verify PIN locally first
    const localCheck = await deleteAccount(deps, { pin });
    if (!localCheck.ok) {
      setDeleting(false);
      setDeleteError(localCheck.error.message);
      return;
    }

    // Call backend to delete account
    try {
      await api.post('/v1/account/delete', { pin });
      // Account deleted - redirect to sign-in
      // The backend will handle data deletion and retention
      router.replace('/sign-in');
    } catch (error) {
      setDeleting(false);
      if (error instanceof Error) {
        setDeleteError(error.message);
      } else {
        setDeleteError('Failed to delete account. Please try again.');
      }
    }
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

      <View style={{ marginTop: s(40), paddingHorizontal: s(16), paddingVertical: s(20), borderRadius: s(12), backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.red }}>
        <T variant="bodyStrong" style={{ fontSize: s(17), marginBottom: s(8), color: colors.red }}>Delete Account</T>
        <T variant="body" color={colors.textSecondary} style={{ lineHeight: s(22), marginBottom: s(16) }}>
          Permanently delete your Paspesa account and all data. This action cannot be undone.
        </T>
        <T variant="caption" color={colors.textSecondary} style={{ marginBottom: s(16), lineHeight: s(19) }}>
          • All simulation data will be deleted{'\n'}
          • Financial records retained for 7 years (legal requirement){'\n'}
          • Unused tokens will be forfeited with no refund
        </T>
        <Pressable
          accessibilityRole="button"
          onPress={handleDeleteRequest}
          style={{ backgroundColor: colors.red, paddingVertical: s(14), borderRadius: s(10), alignItems: 'center' }}
        >
          <T variant="bodyStrong" style={{ color: '#FFFFFF' }}>Request Account Deletion</T>
        </Pressable>
      </View>

      <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={() => { if (!deleting) setShowDeleteModal(false); }}>
        <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: s(24) }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: s(16), padding: s(24), maxWidth: 400, alignSelf: 'center', width: '100%' }}>
            <T variant="heading" style={{ marginBottom: s(16), textAlign: 'center' }}>Delete Account</T>
            <T variant="body" color={colors.textSecondary} style={{ marginBottom: s(20), lineHeight: s(22) }}>
              This will permanently delete your account and all simulation data. Financial records will be retained for 7 years as required by law.
            </T>
            <T variant="body" color={colors.textSecondary} style={{ marginBottom: s(8), lineHeight: s(22) }}>
              Any unused tokens will be forfeited with no refund.
            </T>
            <T variant="bodyStrong" style={{ marginTop: s(16), marginBottom: s(8) }}>Enter your PIN to confirm</T>
            <Field
              value={pin}
              onChangeText={(v) => { setPin(v); setDeleteError(''); }}
              placeholder="4-digit PIN"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              error={deleteError}
              editable={!deleting}
            />
            <View style={{ flexDirection: 'row', gap: s(12), marginTop: s(24) }}>
              <View style={{ flex: 1 }}>
                {deleting ? (
                  <View style={{ paddingVertical: s(14), borderRadius: s(10), borderWidth: 1.2, borderColor: colors.textSecondary, alignItems: 'center', opacity: 0.5 }}>
                    <T variant="bodyStrong" color={colors.textSecondary}>Cancel</T>
                  </View>
                ) : (
                  <OutlineButton title="Cancel" onPress={() => setShowDeleteModal(false)} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={confirmDelete}
                  disabled={deleting || !pin || pin.length !== 4}
                  style={{
                    backgroundColor: deleting || !pin || pin.length !== 4 ? colors.textSecondary : colors.red,
                    paddingVertical: s(14),
                    borderRadius: s(10),
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: s(50),
                  }}
                >
                  {deleting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <T variant="bodyStrong" style={{ color: '#FFFFFF' }}>Delete Forever</T>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
