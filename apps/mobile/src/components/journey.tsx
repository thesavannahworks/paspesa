/**
 * Shared transaction-journey screens, following the reference pattern:
 * entry → Confirm → PIN → Success (reference-screenshots/03…07).
 */
import * as Clipboard from 'expo-clipboard';
import { formatAmount, formatKsh, formatResultTimestamp, toLocalParts, type TransactionRecord } from '@paspesa/core';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BackspaceIcon, ChevronLeftIcon, CloseIcon, CopyIcon, FingerprintIcon, ShareIcon } from '@/icons';
import { confirmBiometric, useBiometrics } from '@/services/biometrics';
import { useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { BadgeCard, CircleButton, Inert, PrimaryButton, Row, Screen, ScreenHeader, T } from './ui';
import { FIXED_TEXT, s } from '@/theme/scale';

// ---------------------------------------------------------------- Confirm

export function ConfirmView({
  badge, title, rows, actionLabel, onConfirm, onBack, error, busy,
}: {
  badge: ReactNode;
  title: string;
  rows: { label: string; value: string }[];
  actionLabel: string;
  onConfirm: () => void;
  onBack: () => void;
  error?: string | null;
  /** Checking the latest settings with the server (a moment). */
  busy?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Screen footer={<PrimaryButton title={actionLabel} onPress={onConfirm} loading={busy} />}>
      <ScreenHeader title="Confirm" onBack={onBack} />
      <View style={{ height: s(208) }} />
      <BadgeCard badge={badge}>
        <T variant="body" center style={{ fontSize: s(21), paddingBottom: s(26) }}>{title}</T>
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.divider, paddingHorizontal: s(28), paddingBottom: s(30), paddingTop: s(14) }}>
          {rows.map((r, i) => <Row key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />)}
        </View>
      </BadgeCard>
      {error ? <T variant="caption" color={colors.red} center style={{ marginTop: s(16) }}>{error}</T> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- PIN

/** How the user approved on the PIN screen. */
export type PinAuth = { pin: string } | { biometric: true };

/** The engine fields for an approval: the PIN, or a biometric approval by the phone. */
export const authFields = (auth: PinAuth) => ('pin' in auth ? { pin: auth.pin } : { authMethod: 'BIOMETRIC' as const });

/**
 * Simulated PIN entry, titled "Enter M-PESA PIN" like the reference (owner decision 2026-11-16). The PIN is
 * the simulated Paspesa PIN set at setup (where users are told never to use their real M-PESA PIN, §44.1).
 * Submits automatically on the 4th digit. When biometrics are turned on, the phone's fingerprint/face
 * prompt opens straight away and a fingerprint key sits in the keypad's empty bottom-left cell.
 */
export function PinView({
  badge, name, amount, fee, onSubmit, onBack, error, busy, keepCase, allowBiometric = true, biometricPrompt,
}: {
  badge: ReactNode;
  name: string;
  /**
   * The PIN screen shows the person or business in capitals whatever was typed (owner, 2026-11-19 — unlike
   * messages and statements, which keep the typed case). `keepCase` for labels such as "Buy Airtime".
   */
  keepCase?: boolean;
  /** Payment amount line; omitted for non-payment uses (unlocking, confirming a setting). */
  amount?: number;
  fee?: number;
  onSubmit: (auth: PinAuth) => void | Promise<void>;
  onBack?: () => void;
  error?: string | null;
  busy?: boolean;
  /** false where the PIN itself must be typed (e.g. turning biometrics on). */
  allowBiometric?: boolean;
  biometricPrompt?: string;
}) {
  const { colors } = useTheme();
  const dark = colors.mode === 'dark';
  const [pin, setPin] = useState('');
  const bio = useBiometrics();
  const canBio = allowBiometric && bio.active;
  const prompted = useRef(false);

  const press = (d: string) => {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    // Clear the boxes once the attempt is processed (a wrong PIN shows the error with empty boxes).
    if (next.length === 4) void Promise.resolve(onSubmit({ pin: next })).finally(() => setPin(''));
  };

  const approveWithBiometrics = useCallback(async () => {
    if (await confirmBiometric(biometricPrompt ?? 'Confirm with your fingerprint')) await onSubmit({ biometric: true });
  }, [biometricPrompt, onSubmit]);

  // Offer biometrics once, as soon as the screen opens.
  useEffect(() => {
    if (!canBio || prompted.current) return;
    prompted.current = true;
    void approveWithBiometrics();
  }, [canBio, approveWithBiometrics]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', canBio ? 'bio' : '', '0', 'del'];
  return (
    <Screen scroll={false}>
      {/* Measured on reference 03-send-money/14 (1.4 px per unit). */}
      <View style={styles.pinHeader}>
        {onBack ? <CircleButton label="Back" size={52} onPress={onBack}><ChevronLeftIcon color={colors.text} size={28} /></CircleButton> : <View style={{ width: s(52), height: s(52) }} />}
        <T variant="bodyStrong" style={{ flex: 1, textAlign: 'center', marginRight: s(41.7), fontSize: s(20.7) }}>Enter M-PESA PIN</T>
      </View>
      <View style={{ alignItems: 'center', marginTop: s(77.5) }}>
        {badge}
        <T variant="body" color={dark ? '#D7D7D7' : colors.textSecondary} style={{ marginTop: s(20.6), fontSize: s(23.2), lineHeight: s(27) }} center>{keepCase ? name : name.toUpperCase()}</T>
        {amount !== undefined ? (
          <T variant="label" color={dark ? '#DFDFDF' : colors.textSecondary} style={{ marginTop: s(15.6), fontSize: s(18.1), lineHeight: s(22) }}>
            Ksh. {formatAmount(amount)}  Fee:Ksh. {formatAmount(fee ?? 0)}
          </T>
        ) : <View style={{ height: s(37.6) }} />}
        <View style={{ flexDirection: 'row', gap: s(20), marginTop: s(85) }}>
          {[0, 1, 2, 3].map((i) => {
            const filled = i < pin.length;
            return (
              <View key={i} style={[styles.pinBox, { borderColor: filled ? colors.green : dark ? '#BEC1C6' : '#D5DCE2' }]}>
                {filled ? <View style={[styles.pinDot, { backgroundColor: colors.green }]} /> : null}
              </View>
            );
          })}
        </View>
        <T variant="caption" color={colors.red} style={{ marginTop: s(16), minHeight: s(18) }} center>{error ?? ''}</T>
      </View>
      <View style={styles.keypad}>
        {keys.map((k, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={k === 'del' ? 'Delete' : k === 'bio' ? 'Use biometrics' : k || undefined}
            disabled={!k || busy}
            onPress={() => (k === 'del' ? setPin((p) => p.slice(0, -1)) : k === 'bio' ? void approveWithBiometrics() : press(k))}
            style={({ pressed }) => [styles.key, pressed && k ? { opacity: 0.5 } : null]}
          >
            {k === 'del' ? <BackspaceIcon size={36} strokeWidth={1.3} />
              : k === 'bio' ? <FingerprintIcon size={38} />
              : <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ fontSize: s(36), fontWeight: '400', color: colors.text }}>{k}</Text>}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------- Success

export function SuccessView({
  transaction, partyLabel, partyBadge, partyLines, actions, onDone, cardFooter, banner,
}: {
  transaction: TransactionRecord;
  partyLabel: string;
  partyBadge: ReactNode;
  partyLines: string[];
  actions?: ReactNode;
  onDone: () => void;
  /** Extra content at the bottom of the result card (e.g. Buy Goods "Liked our Service?"). */
  cardFooter?: ReactNode;
  /** Content between the card and the action row (e.g. the ZiiDi banner). */
  banner?: ReactNode;
}) {
  const { colors } = useTheme();
  const { deps } = useAppState();
  const [copied, setCopied] = useState(false);
  const when = formatResultTimestamp(toLocalParts(transaction.completedAt, deps.config.utcOffsetMinutes));

  const copy = async () => {
    await Clipboard.setStringAsync(transaction.reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Screen footer={<PrimaryButton title="Done" onPress={onDone} />}>
      <View style={styles.successTop}>
        <CircleButton label="Close" onPress={onDone} size={54}><CloseIcon size={28} /></CircleButton>
        <Inert style={[styles.sharePill, { backgroundColor: colors.mode === 'dark' ? colors.surface : colors.screen, borderColor: colors.border }]}>
          <ShareIcon />
          <T variant="bodyStrong" style={{ fontWeight: '500' }}>Share Details</T>
        </Inert>
      </View>
      <BadgeCard badge={<Text maxFontSizeMultiplier={FIXED_TEXT} style={{ fontSize: s(56) }}>🎉</Text>} style={{ marginTop: s(70) }} badgeSize={114}>
        <View style={{ paddingHorizontal: s(20), paddingBottom: s(26), alignItems: 'center' }}>
          <T variant="title" center style={{ fontSize: s(30), fontWeight: '400', lineHeight: s(38), paddingHorizontal: s(40) }}>Your transaction was successful</T>
          <T variant="label" color={colors.textSecondary} style={{ marginTop: s(26), fontSize: s(16) }}>{when}</T>
          <T variant="amount" style={{ marginTop: s(28) }}>{formatKsh(transaction.amount)}</T>
          <T variant="label" color={colors.textSecondary} style={{ marginTop: s(28), fontSize: s(15.5) }}>
            Transaction cost:<Text maxFontSizeMultiplier={FIXED_TEXT} style={{ fontWeight: '600', color: colors.textSecondary }}>{formatKsh(transaction.fee)}</Text>
          </T>
          <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel="Copy transaction ID" style={[styles.idPill, { backgroundColor: colors.mode === 'light' ? colors.greenSoft : 'transparent' }]}>
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.green, fontWeight: '600', fontSize: s(19) }}>ID: {transaction.reference}</Text>
            <CopyIcon size={18} />
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.green, fontSize: s(19) }}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
          <View style={[styles.partyBox, { backgroundColor: colors.raised }]}>
            <T variant="label" style={{ fontSize: s(15.5) }}>{partyLabel}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(20), marginTop: s(16) }}>
              {partyBadge}
              <View style={{ flex: 1 }}>
                {partyLines.map((line, i) => (
                  <T key={i} variant="body" color={i === 2 ? colors.textSecondary : colors.text} style={{ fontSize: s(17.5), marginTop: i ? s(8) : 0 }}>{line}</T>
                ))}
              </View>
            </View>
          </View>
          {cardFooter}
        </View>
      </BadgeCard>
      {banner}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </Screen>
  );
}

export function ResultAction({ icon, label, onPress, inert }: { icon: ReactNode; label: string; onPress?: () => void; inert?: boolean }) {
  const { colors } = useTheme();
  const content = (
    <View style={{ alignItems: 'center', width: s(110) }}>
      <View style={{ width: s(54), height: s(54), borderRadius: s(27), backgroundColor: colors.mode === 'dark' ? colors.raised : colors.raised, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <T variant="label" center style={{ marginTop: s(14), fontSize: s(16), lineHeight: s(21) }}>{label}</T>
    </View>
  );
  if (inert || !onPress) return <Inert>{content}</Inert>;
  return <Pressable accessibilityRole="button" onPress={onPress}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  pinHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: s(21), marginLeft: -s(10.3) },
  pinBox: { width: s(62), height: s(62), borderRadius: s(10), borderWidth: 1.4, alignItems: 'center', justifyContent: 'center' },
  pinDot: { width: s(20), height: s(20), borderRadius: s(10) },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 'auto', marginBottom: s(61.5), marginHorizontal: -s(21) },
  key: { width: '33.33%', height: s(105), alignItems: 'center', justifyContent: 'center' },
  successTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: s(28) },
  sharePill: { flexDirection: 'row', alignItems: 'center', gap: s(14), paddingHorizontal: s(20), paddingVertical: s(14), borderRadius: s(12), borderWidth: StyleSheet.hairlineWidth },
  idPill: { flexDirection: 'row', alignItems: 'center', gap: s(8), marginTop: s(12), paddingHorizontal: s(14), paddingVertical: s(6), borderRadius: s(10) },
  partyBox: { alignSelf: 'stretch', marginTop: s(36), borderRadius: s(14), padding: s(22), paddingVertical: s(26) },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: s(32) },
});
