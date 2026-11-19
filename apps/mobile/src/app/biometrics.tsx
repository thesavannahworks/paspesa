/**
 * Biometrics (reference-screenshots/02-profile-settings/06, measured at 1.4 px per unit).
 * Turning biometrics on requires the PIN, then the phone's own biometric check. Once on, biometrics
 * unlock the app and approve anything that asks for the PIN. Turning it off needs no PIN.
 */
import { verifyPin } from '@paspesa/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PinView, type PinAuth } from '@/components/journey';
import { CircleButton, Screen, T, Toggle } from '@/components/ui';
import { ChevronLeftIcon, FingerprintIcon, ShieldBugIcon } from '@/icons';
import { useAppState } from '@/services/AppState';
import { confirmBiometric, supportMessage, useBiometrics } from '@/services/biometrics';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

export default function BiometricsScreen() {
  const { colors } = useTheme();
  const dark = colors.mode === 'dark';
  const { deps } = useAppState();
  const bio = useBiometrics();
  const [step, setStep] = useState<'main' | 'pin'>('main');
  const [pinError, setPinError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fingerprintBadge = (size: number, icon: number) => (
    <View style={{ width: s(size), height: s(size), borderRadius: s(size / 2), backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
      <FingerprintIcon size={icon} strokeWidth={1.15} />
    </View>
  );

  const onToggle = (on: boolean) => {
    setNotice(null);
    if (!on) return bio.setEnabled(false);
    const msg = supportMessage(bio.support);
    if (msg) return setNotice(msg);
    setPinError(null);
    setStep('pin');
  };

  const onPin = async (auth: PinAuth) => {
    if (!('pin' in auth)) return;
    setBusy(true);
    const res = await verifyPin(deps, auth.pin);
    if (!res.ok) {
      setBusy(false);
      return setPinError(res.error.message);
    }
    const confirmed = await confirmBiometric('Confirm to turn on biometrics');
    setBusy(false);
    setStep('main');
    if (confirmed) bio.setEnabled(true);
    else setNotice('Biometrics were not turned on. Try again when you are ready.');
  };

  if (step === 'pin') {
    return (
      <PinView
        badge={fingerprintBadge(79, 52)}
        name="Turn on Biometrics"
        keepCase
        allowBiometric={false}
        onSubmit={onPin}
        onBack={() => setStep('main')}
        error={pinError}
        busy={busy}
      />
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <CircleButton label="Back" size={52} onPress={() => router.back()}><ChevronLeftIcon color={colors.text} size={28} /></CircleButton>
        <T variant="title" color={dark ? '#E4E4E4' : colors.text} style={styles.title}>Biometrics</T>
      </View>

      <View style={{ alignItems: 'center', marginTop: s(74) }}>
        {fingerprintBadge(94, 62)}
        <T variant="title" center color={dark ? '#E4E4E4' : colors.text} style={{ marginTop: s(22.5), fontSize: s(27), lineHeight: s(33), fontWeight: '500' }}>Turn on Biometrics?</T>
        <T variant="body" center color={dark ? '#D0D0D0' : colors.textSecondary} style={{ marginTop: s(10.3), fontSize: s(17.4), lineHeight: s(26.4) }}>
          When enabled, you will use your devices biometrics to unlock the app and authenticate your transactions
        </T>
      </View>

      <View style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: colors.raised }]}><ShieldBugIcon size={30} /></View>
        <View style={{ flex: 1, marginLeft: s(11.7), marginRight: s(29) }}>
          <T variant="bodyStrong" color={dark ? '#E4E4E4' : colors.text} style={{ fontSize: s(18.5), lineHeight: s(22), fontWeight: '500' }}>Unlock App</T>
          <T variant="label" color={dark ? '#C8C8C8' : colors.textSecondary} style={{ fontSize: s(16), lineHeight: s(21.4), marginTop: s(1) }}>
            Turn on if you wish to use biometrics to unlock the app
          </T>
        </View>
        <Toggle label="Unlock App" value={bio.enabled} onChange={onToggle} />
      </View>
      {notice ? <T variant="caption" color={colors.red} style={{ marginTop: s(18), marginHorizontal: s(21) }}>{notice}</T> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: s(21) },
  title: { flex: 1, textAlign: 'center', marginRight: s(52), fontSize: s(20.5), fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: s(61.8), paddingLeft: s(21), paddingRight: s(22) },
  rowIcon: { width: s(47), height: s(47), borderRadius: s(23.5), alignItems: 'center', justifyContent: 'center' },
});
