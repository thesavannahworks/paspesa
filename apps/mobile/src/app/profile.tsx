import { toLocalPhone } from '@paspesa/core';
import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { UserAvatar } from '@/components/UserAvatar';
import { Inert, Screen, ScreenHeader, Sheet, SheetRow, T } from '@/components/ui';
import { CameraIcon, ChevronLeftIcon, ChevronRightIcon, TokenIcon, FingerprintIcon, GalleryIcon, GearIcon, InfoIcon, LockIcon, MoonIcon, PersonIcon, ShareIcon, SunIcon, TrashIcon, WalletIcon } from '@/icons';
import { useProfilePhoto } from '@/services/profilePhoto';
import { useSyncStatus } from '@/services/sync';
import { useAccount } from '@/services/AppState';
import { useTheme, type ThemeChoice } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

/**
 * Profile (reference: 02-profile-settings). Only items that concern Paspesa are kept;
 * Safaricom "Quick Care" services are omitted (owner instruction). General Operations and
 * Paspesa PIN are Paspesa additions.
 */
export default function ProfileScreen() {
  const { colors } = useTheme();
  const account = useAccount();
  const [themeOpen, setThemeOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  return (
    <Screen background="page">
      <ScreenHeader title="Profile" />
      <View style={[styles.card, { backgroundColor: colors.surface, marginTop: s(40) }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View>
            <UserAvatar size={88} />
            <Pressable accessibilityRole="button" accessibilityLabel="Change profile picture" onPress={() => setPhotoOpen(true)} hitSlop={8} style={[styles.cameraBadge, { backgroundColor: colors.raised, borderColor: colors.surface }]}>
              <CameraIcon size={22} />
            </Pressable>
          </View>
          <T variant="title" style={{ marginLeft: s(30), fontSize: s(26) }} numberOfLines={2}>{account.accountName}</T>
        </View>
        <View style={{ flexDirection: 'row', marginTop: s(18) }}>
          <Stat label="Phone No." value={toLocalPhone(account.phoneNumber)} />
          <Stat label="Status" value="Active" />
          <Stat label="Tariff" value="Prepaid" />
        </View>
      </View>

      {/* Paspesa's own token wallet: balance, buying, setting aside on this phone, history (§26–31). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Paspesa Tokens"
        onPress={() => router.push('/wallet')}
        style={[styles.tokensCard, { backgroundColor: colors.surface }]}
      >
        <View style={[styles.tileIcon, { backgroundColor: colors.raised, marginBottom: 0 }]}><TokenIcon size={28} /></View>
        <View style={{ flex: 1, marginLeft: s(14) }}>
          <T variant="bodyStrong" style={{ fontSize: s(18) }}>Paspesa Tokens</T>
          <T variant="label" color={colors.textSecondary} style={{ marginTop: s(3), fontSize: s(15) }}>
            {account.tokenAllocation ? `${account.tokenAllocation.remaining} on this phone · buy, balance, history` : 'Buy tokens, balance and history'}
          </T>
        </View>
        <ChevronRightIcon size={22} color={colors.textSecondary} />
      </Pressable>

      <T variant="heading" style={{ marginTop: s(34), fontSize: s(22) }}>Quick actions</T>
      <View style={styles.tileRow}>
        <Tile icon={<SunIcon size={28} />} label="Appearance" onPress={() => setThemeOpen(true)} wide />
        <Tile icon={<FingerprintIcon size={28} />} label={'Biometric\nAuthentication'} href="/biometrics" wide />
      </View>

      <T variant="heading" style={{ marginTop: s(34), fontSize: s(22) }}>Account and Settings</T>
      <View style={styles.tileRow}>
        <Tile icon={<WalletIcon size={28} />} label={'General\nOperations'} href="/general-operations" />
        <Tile icon={<LockIcon size={28} />} label="Paspesa PIN" href="/change-pin" />
        <Tile icon={<InfoIcon size={28} />} label="About App" />
      </View>
      <View style={styles.tileRow}>
        <Tile icon={<PersonIcon size={28} />} label={'Account\nDetails'} href="/account-details" />
        <Tile icon={<ShareIcon size={28} />} label={'Recommend\nA Friend'} />
      </View>

      <T variant="label" color={colors.textSecondary} style={{ marginTop: s(30) }}>
        App Version {Constants.expoConfig?.version ?? '1.0.0'}
      </T>
      <SyncLine />

      <ThemeSheet visible={themeOpen} onClose={() => setThemeOpen(false)} />
      <PhotoSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} />
    </Screen>
  );
}

/** Backup / sync state (White Paper §24.1), shown only when a backend is configured. */
function SyncLine() {
  const { colors } = useTheme();
  const st = useSyncStatus();
  if (!st?.enabled) return null;
  const text = st.running ? 'Backing up…'
    : st.needsReview ? `Backup: ${st.needsReview} item${st.needsReview === 1 ? '' : 's'} need review`
    : st.waiting ? `Backup: ${st.waiting} waiting${st.lastError ? ' (offline)' : ''}`
    : st.lastSyncedAt ? 'Backup: up to date' : 'Backup: waiting to connect';
  return <T variant="label" color={st.needsReview ? colors.red : colors.textSecondary} style={{ marginTop: s(6) }}>{text}</T>;
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <T variant="label" color={colors.textSecondary} style={{ fontSize: s(17) }}>{label}</T>
      <T variant="label" style={{ fontSize: s(18), marginTop: s(8) }}>{value}</T>
    </View>
  );
}

function Tile({ icon, label, onPress, href, wide }: { icon: ReactNode; label: string; onPress?: () => void; href?: Href; wide?: boolean }) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.tile, { backgroundColor: colors.surface }]}>
      <View style={[styles.tileIcon, { backgroundColor: colors.raised }]}>{icon}</View>
      <T variant="label" style={{ fontSize: s(16), lineHeight: s(22) }}>{label}</T>
    </View>
  );
  const action = onPress ?? (href ? () => router.push(href) : undefined);
  const flex = wide ? { flex: 1 } : { width: '31.5%' as const };
  return action ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label.replace('\n', ' ')} onPress={action} style={flex}>{content}</Pressable>
  ) : (
    <Inert style={flex}>{content}</Inert>
  );
}

/** Change Profile Picture (reference: 02-profile-settings/05). The photo stays on this device. */
function PhotoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const photo = useProfilePhoto();
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setError(null);
    const res = await action();
    if (res.ok) onClose();
    else if (res.reason === 'denied') setError('Allow camera access in your phone settings to take a photo.');
    else if (res.reason === 'failed') setError('The picture could not be saved. Please try again.');
  };
  const close = () => { setError(null); onClose(); };
  return (
    <Sheet visible={visible} title="Change Profile Picture" onClose={close}>
      <View style={{ marginTop: s(18) }}>
        <SheetRow icon={<CameraIcon size={24} />} label="Take a Photo" onPress={() => run(photo.take)} />
        <SheetRow icon={<GalleryIcon size={24} />} label="Pick from Gallery" onPress={() => run(photo.pick)} />
        {photo.uri ? <SheetRow icon={<TrashIcon size={24} />} label="Remove Profile Picture" onPress={() => { photo.remove(); close(); }} /> : null}
      </View>
      {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(8) }}>{error}</T> : null}
    </Sheet>
  );
}

function ThemeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, choice, setChoice } = useTheme();
  const options: { key: ThemeChoice; label: string; icon: ReactNode }[] = [
    { key: 'light', label: 'Light Mode', icon: <SunIcon size={30} /> },
    { key: 'dark', label: 'Dark Mode', icon: <MoonIcon size={30} color={colors.mode === 'dark' ? '#CFCFCF' : '#555555'} /> },
    { key: 'system', label: 'System', icon: <GearIcon size={30} color={colors.mode === 'dark' ? '#CFCFCF' : '#555555'} /> },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: colors.mode === 'dark' ? '#1B1B1B' : colors.screen }]}>
        <View style={[styles.grabber, { backgroundColor: colors.textMuted }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: s(18) }}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Back" style={[styles.sheetBack, { backgroundColor: colors.raised }]}>
            <ChevronLeftIcon color={colors.text} size={22} />
          </Pressable>
          <T variant="title" style={{ flex: 1, textAlign: 'center', marginRight: s(48) }}>Theme</T>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: s(28), marginBottom: s(20) }}>
          {options.map((o) => (
            <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ checked: choice === o.key }} onPress={() => setChoice(o.key)} style={{ alignItems: 'center' }}>
              <View style={[styles.themeCircle, { borderColor: colors.mode === 'dark' ? '#3A3A3A' : '#E3E3E3', backgroundColor: colors.mode === 'dark' ? '#262626' : colors.raised }]}>
                {o.icon}
                {choice === o.key ? (
                  <View style={[styles.check, { backgroundColor: colors.green }]}><T variant="caption" color="#FFFFFF" style={{ fontWeight: '700' }}>✓</T></View>
                ) : null}
              </View>
              <T variant="body" style={{ marginTop: s(14), fontSize: s(18) }}>{o.label}</T>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tokensCard: { flexDirection: 'row', alignItems: 'center', borderRadius: s(14), padding: s(16), marginTop: s(20) },
  card: { borderRadius: s(16), padding: s(22) },
  cameraBadge: { position: 'absolute', right: s(-14), bottom: s(-6), width: s(44), height: s(44), borderRadius: s(22), alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  tileRow: { flexDirection: 'row', gap: s(12), marginTop: s(16) },
  tile: { borderRadius: s(14), padding: s(14), minHeight: s(150), justifyContent: 'space-between' },
  tileIcon: { width: s(46), height: s(46), borderRadius: s(10), alignItems: 'center', justifyContent: 'center', marginBottom: s(20) },
  sheet: { borderTopLeftRadius: s(26), borderTopRightRadius: s(26), paddingHorizontal: s(20), paddingBottom: s(30) },
  grabber: { alignSelf: 'center', width: s(56), height: s(5), borderRadius: s(3), marginTop: s(10) },
  sheetBack: { width: s(48), height: s(48), borderRadius: s(24), alignItems: 'center', justifyContent: 'center' },
  themeCircle: { width: s(110), height: s(110), borderRadius: s(55), borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', top: 0, right: s(2), width: s(28), height: s(28), borderRadius: s(14), alignItems: 'center', justifyContent: 'center' },
});
