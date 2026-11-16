/**
 * Scan to Pay (reference-screenshots/10-scan-to-pay).
 * Scan QR: reads Paspesa payment QR codes (live camera, a photo taken with the shutter, or a gallery
 * image) and opens the matching journey pre-filled. My QR: the user's own code for receiving money.
 * Only Paspesa codes are understood; real M-PESA/merchant codes are not decoded.
 */
import { encodePaymentQr, formatKsh, parsePaymentQr, parseWholeShillings, toLocalPhone, type QrPayment } from '@paspesa/core';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserAvatar } from '@/components/UserAvatar';
import { Field, PrimaryButton, SegmentedTabs, Sheet, T } from '@/components/ui';
import { CameraOffArt, ChevronLeftIcon, DownloadIcon, FlashOffIcon, FlashOnIcon, GalleryIcon, PochiWalletIcon } from '@/icons';
import { useAccount } from '@/services/AppState';
import { saveQr } from '@/services/saveQr';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

type Tab = 'scan' | 'mine';

export default function ScanToPayScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'mine' ? 'mine' : 'scan');
  const [permission, requestPermission] = useCameraPermissions();
  const live = tab === 'scan' && !!permission?.granted;
  const st = useScannerState();
  const camera = useRef<CameraView>(null);

  return (
    <View style={{ flex: 1, backgroundColor: live ? '#000000' : colors.screen }}>
      {live ? <Scanner st={st} camera={camera} /> : null}
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.header} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}
            style={[styles.back, tab === 'mine' && { backgroundColor: colors.mode === 'dark' ? '#F7F2FA' : colors.raised }]}>
            <ChevronLeftIcon color={tab === 'mine' && colors.mode === 'dark' ? '#121212' : live ? '#FFFFFF' : colors.text} size={26} />
          </Pressable>
          <T variant="title" color={live ? '#FFFFFF' : colors.text} style={styles.title}>Scan to pay</T>
        </View>
        <View style={{ paddingHorizontal: s(21), marginTop: s(10) }}>
          <SegmentedTabs value={tab} onChange={setTab} tabs={[{ key: 'scan', label: 'Scan QR' }, { key: 'mine', label: 'My QR' }]} />
        </View>
        {tab === 'mine' ? (
          <MyQr />
        ) : !permission ? (
          <ActivityIndicator color={colors.green} style={{ marginTop: s(80) }} />
        ) : permission.granted ? (
          <ScanOverlayHint />
        ) : (
          <CameraPermission canAsk={permission.canAskAgain} onEnable={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())} />
        )}
      </SafeAreaView>
      {live ? <ScannerControls st={st} camera={camera} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- permission

function CameraPermission({ canAsk, onEnable }: { canAsk: boolean; onEnable: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, paddingHorizontal: s(21), justifyContent: 'center', paddingBottom: s(240) }}>
      <View style={{ alignItems: 'center' }}>
        <CameraOffArt width={200} />
        <T variant="bodyStrong" center style={{ marginTop: s(26), fontSize: s(16.5), fontWeight: '500' }}>We can’t access your camera just yet</T>
        <T variant="body" color={colors.textSecondary} center style={{ marginTop: s(16), fontSize: s(16) }}>
          {canAsk ? 'Allow camera permissions so you can scan quickly.' : 'Camera access is off. Turn it on in your phone settings to scan.'}
        </T>
      </View>
      <PrimaryButton title={canAsk ? 'Enable Camera' : 'Open Settings'} onPress={onEnable} style={{ marginTop: s(30) }} />
    </View>
  );
}

// ---------------------------------------------------------------- scanning

const NOT_PASPESA = 'This is not a Paspesa payment QR code';

/** Opens the matching journey pre-filled. Returns false when the code is not a Paspesa payment code. */
function openPayment(data: string): boolean {
  const payment = parsePaymentQr(data);
  if (!payment) return false;
  router.replace({ pathname: payment.type === 'SEND_MONEY' || payment.type === 'POCHI' ? '/send-money' : '/lipa', params: paymentParams(payment) });
  return true;
}

function paymentParams(p: QrPayment): Record<string, string> {
  const params: Record<string, string> = { tab: p.type };
  for (const [k, v] of Object.entries(p.counterparty)) if (v) params[k] = k === 'phone' ? toLocalPhone(v) : v;
  if (p.amount) params.amount = String(p.amount);
  return params;
}

interface ScannerState {
  torch: boolean;
  setTorch: (on: boolean) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  notice: string | null;
  notify: (message: string) => void;
}

function useScannerState(): ScannerState {
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 3500);
  }, []);
  return { torch, setTorch, busy, setBusy, notice, notify };
}

function Scanner({ st, camera }: { st: ScannerState; camera: RefObject<CameraView | null> }) {
  const handled = useRef(false);
  return (
    <CameraView
      ref={camera}
      style={StyleSheet.absoluteFill}
      facing="back"
      enableTorch={st.torch}
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={({ data }) => {
        if (handled.current || st.busy) return;
        if (openPayment(data)) handled.current = true;
        else if (st.notice !== NOT_PASPESA) st.notify(NOT_PASPESA);
      }}
    />
  );
}

function ScanOverlayHint() {
  return (
    <View style={{ flex: 1, alignItems: 'center' }} pointerEvents="none">
      <Text maxFontSizeMultiplier={FIXED_TEXT} style={styles.hint}>Scan QR codes or capture images with clear payment details.</Text>
      <View style={styles.frame} />
    </View>
  );
}

function ScannerControls({ st, camera }: { st: ScannerState; camera: RefObject<CameraView | null> }) {
  const scanImage = async (uri: string) => {
    st.setBusy(true);
    try {
      const results = await scanFromURLAsync(uri, ['qr']);
      if (!results.some((r) => openPayment(r.data))) st.notify(results.length ? NOT_PASPESA : 'No QR code found in the picture');
    } catch {
      st.notify('The picture could not be read. Please try again.');
    } finally {
      st.setBusy(false);
    }
  };
  const capture = async () => {
    if (st.busy || !camera.current) return;
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) await scanImage(photo.uri);
    } catch {
      st.notify('The photo could not be taken. Please try again.');
    }
  };
  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!res.canceled && res.assets[0]) await scanImage(res.assets[0].uri);
  };
  return (
    <SafeAreaView edges={['bottom']} style={styles.controls} pointerEvents="box-none">
      {st.notice ? (
        <View style={styles.notice}><Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: '#FFFFFF', fontSize: s(15), textAlign: 'center' }}>{st.notice}</Text></View>
      ) : null}
      <Text maxFontSizeMultiplier={FIXED_TEXT} style={styles.shutterLabel}>Scan Photo</Text>
      <View style={styles.controlRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Scan a picture from the gallery" onPress={pick} style={styles.sideButton}>
          <GalleryIcon size={40} color="#FFFFFF" accent="#FFFFFF" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Scan Photo" onPress={capture} style={styles.shutterOuter}>
          {st.busy ? <ActivityIndicator color="#36A839" /> : <View style={styles.shutterInner} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={st.torch ? 'Turn flash off' : 'Turn flash on'} onPress={() => st.setTorch(!st.torch)} style={styles.sideButton}>
          {st.torch ? <FlashOnIcon size={40} /> : <FlashOffIcon size={40} />}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- My QR

function MyQr() {
  const { colors } = useTheme();
  const account = useAccount();
  const card = useRef<ComponentRef<typeof View>>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const value = encodePaymentQr({
    type: 'SEND_MONEY',
    counterparty: { phone: account.phoneNumber, name: account.accountName },
    ...(amount ? { amount } : {}),
  });

  const apply = () => {
    const a = parseWholeShillings(draft);
    if (a === null || a < 1 || a > 250_000) return setError('Enter a whole amount between Ksh 1 and Ksh 250,000');
    setAmount(a);
    setSheet(false);
    setError(null);
  };

  const save = async () => {
    const res = await saveQr(card);
    setNotice(res.message);
    setTimeout(() => setNotice(null), 3000);
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: s(21) }}>
      <T variant="body" color={colors.textSecondary} center style={{ marginTop: s(26), fontSize: s(16), lineHeight: s(26), paddingHorizontal: s(14) }}>
        Set up your QR code to enable payments from others directly to your account.
      </T>
      <View ref={card} collapsable={false} style={{ alignItems: 'center', marginTop: s(18), paddingVertical: s(4), backgroundColor: colors.screen }}>
        <View style={styles.qrWrap}>
          <QRCode value={value} size={s(312)} ecl="H" backgroundColor="#FFFFFF" color="#000000" quietZone={s(4)} />
          <View style={styles.qrLogo} pointerEvents="none"><PochiWalletIcon size={50} /></View>
        </View>
        <View style={{ marginTop: s(12) }}><UserAvatar size={82} /></View>
        <T variant="body" style={{ marginTop: s(12), fontSize: s(16) }} color={colors.textSecondary}>{account.accountName.toUpperCase()}</T>
        {amount ? <T variant="bodyStrong" style={{ marginTop: s(6), fontSize: s(17) }}>{formatKsh(amount)}</T> : null}
      </View>
      <View style={{ alignItems: 'flex-end', marginTop: s(12) }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Download QR code" onPress={save} hitSlop={10}><DownloadIcon size={30} /></Pressable>
      </View>
      {notice ? <T variant="caption" color={colors.green} center>{notice}</T> : null}
      <PrimaryButton title={amount ? 'Change amount' : 'Add amount to QR'} onPress={() => { setDraft(amount ? String(amount) : ''); setSheet(true); }} style={{ marginTop: s(30) }} />
      {amount ? (
        <Pressable accessibilityRole="button" onPress={() => setAmount(null)} style={{ alignSelf: 'center', marginTop: s(14) }}>
          <T variant="label" color={colors.green}>Remove amount</T>
        </Pressable>
      ) : null}

      <Sheet visible={sheet} title="Add amount to QR" onClose={() => { setSheet(false); setError(null); }}>
        <Field label="Enter amount" placeholder="0" value={draft} onChangeText={(v) => { setDraft(v); setError(null); }} keyboardType="number-pad" right={<T variant="body">Ksh</T>} error={error ?? undefined} />
        <PrimaryButton title="Add to QR" onPress={apply} disabled={draft.trim() === ''} style={{ marginTop: s(22) }} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: s(16), paddingTop: s(10), minHeight: s(62) },
  back: { width: s(52), height: s(52), borderRadius: s(26), alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', marginRight: s(52), fontSize: s(19), fontWeight: '600' },
  hint: { color: '#FFFFFF', fontSize: s(16), textAlign: 'center', marginTop: s(140), paddingHorizontal: s(30), fontWeight: '500', lineHeight: s(24) },
  frame: { width: s(472), height: s(476), borderRadius: s(18), borderWidth: 1.5, borderColor: '#36A839', marginTop: s(20) },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: s(20) },
  notice: { backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: s(10), paddingHorizontal: s(16), paddingVertical: s(10), marginBottom: s(14), marginHorizontal: s(24) },
  shutterLabel: { color: '#FFFFFF', fontSize: s(16), fontWeight: '500', marginBottom: s(12) },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: s(24) },
  sideButton: { width: s(56), height: s(56), alignItems: 'center', justifyContent: 'center' },
  shutterOuter: { width: s(96), height: s(96), borderRadius: s(48), borderWidth: s(4), borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: s(80), height: s(80), borderRadius: s(40), backgroundColor: '#FFFFFF' },
  qrWrap: { backgroundColor: '#FFFFFF', padding: s(2), alignItems: 'center', justifyContent: 'center' },
  qrLogo: { position: 'absolute', width: s(66), height: s(66), borderRadius: s(33), backgroundColor: '#1B1B1B', alignItems: 'center', justifyContent: 'center', borderWidth: s(4), borderColor: '#36A839' },
});
