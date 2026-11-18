/**
 * Blocking screen shown while the back office has suspended this device or its account (see the server's
 * suspension.ts). It is remembered offline and lifts by itself on the first request that goes through after
 * the suspension is undone ("Check again" asks right away).
 *
 * A suspended account's device may still sign out and be used with another email. That signs out without
 * uploading (the server refuses this account's uploads), so anything not backed up is lost — said plainly.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { OutlineButton, PrimaryButton, T } from '@/components/ui';
import { LockIcon } from '@/icons';
import { checkSuspension, signOut, useSession } from '@/services/session';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';
import { AppModal as Modal } from './LayoutFrame';

export function Suspended() {
  const { colors } = useTheme();
  const { suspended } = useSession();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!suspended) return null;
  const account = suspended.kind === 'ACCOUNT';

  const check = async () => {
    setBusy(true);
    await checkSuspension();
    setBusy(false);
  };

  return (
    <Modal visible animationType="none" onRequestClose={() => undefined}>
      <View style={{ flex: 1, backgroundColor: colors.screen, paddingHorizontal: s(26), justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: s(84), height: s(84), borderRadius: s(42), backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
            <LockIcon size={40} color={colors.red} accent={colors.red} />
          </View>
          <T variant="heading" center style={{ marginTop: s(22), fontSize: s(22) }}>
            {account ? 'Account suspended' : 'Device suspended'}
          </T>
          <T variant="body" color={colors.textSecondary} center style={{ marginTop: s(12), fontSize: s(16), lineHeight: s(23) }}>
            {suspended.message}
          </T>
        </View>
        {confirming ? (
          <View style={{ marginTop: s(30) }}>
            <T variant="body" color={colors.textSecondary} center style={{ fontSize: s(15), lineHeight: s(21) }}>
              Signing out clears this account from this device. Anything recorded here that was not backed up is lost. The account itself stays saved.
            </T>
            <PrimaryButton title="Sign out" loading={busy} onPress={() => { setBusy(true); void signOut(true).finally(() => setBusy(false)); }} style={{ marginTop: s(16) }} />
            <View style={{ marginTop: s(12) }}><OutlineButton title="Cancel" onPress={() => setConfirming(false)} /></View>
          </View>
        ) : (
          <View style={{ marginTop: s(30) }}>
            <PrimaryButton title="Check again" loading={busy} onPress={() => void check()} />
            {account ? <View style={{ marginTop: s(12) }}><OutlineButton title="Sign out and use another email" onPress={() => setConfirming(true)} /></View> : null}
          </View>
        )}
      </View>
    </Modal>
  );
}
