/**
 * Shared transaction-journey screens, following the reference pattern:
 * entry → Confirm → PIN → Success (reference-screenshots/03…07).
 */
import * as Clipboard from 'expo-clipboard';
import { formatAmount, formatKsh, formatResultTimestamp, toLocalParts, type TransactionRecord } from '@paspesa/core';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BackspaceIcon, ChevronLeftIcon, CloseIcon, CopyIcon, ShareIcon } from '@/icons';
import { useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { BadgeCard, CircleButton, Inert, PrimaryButton, Row, Screen, ScreenHeader, T } from './ui';

// ---------------------------------------------------------------- Confirm

export function ConfirmView({
  badge, title, rows, actionLabel, onConfirm, onBack, error,
}: {
  badge: ReactNode;
  title: string;
  rows: Array<{ label: string; value: string }>;
  actionLabel: string;
  onConfirm: () => void;
  onBack: () => void;
  error?: string | null;
}) {
  const { colors } = useTheme();
  return (
    <Screen footer={<PrimaryButton title={actionLabel} onPress={onConfirm} />}>
      <ScreenHeader title="Confirm" onBack={onBack} />
      <View style={{ height: 90 }} />
      <BadgeCard badge={badge}>
        <T variant="body" center style={{ fontSize: 18, paddingBottom: 22 }}>{title}</T>
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.divider, paddingHorizontal: 28, paddingBottom: 24, paddingTop: 10 }}>
          {rows.map((r, i) => <Row key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />)}
        </View>
      </BadgeCard>
      {error ? <T variant="caption" color={colors.red} center style={{ marginTop: 16 }}>{error}</T> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- PIN

/**
 * Simulated Paspesa PIN entry. Never the real M-PESA PIN (White Paper §44.1).
 * Submits automatically on the 4th digit.
 */
export function PinView({
  badge, name, amount, fee, onSubmit, onBack, error, busy,
}: {
  badge: ReactNode;
  name: string;
  amount: number;
  fee: number;
  onSubmit: (pin: string) => void;
  onBack: () => void;
  error?: string | null;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (error) setPin('');
  }, [error]);

  const press = (d: string) => {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) onSubmit(next);
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <Screen scroll={false}>
      <View style={styles.pinHeader}>
        <CircleButton label="Back" onPress={onBack}><BackChevron /></CircleButton>
        <T variant="bodyStrong" style={{ flex: 1, textAlign: 'center', marginRight: 40, fontSize: 17 }}>Enter Paspesa PIN</T>
      </View>
      <View style={{ alignItems: 'center', marginTop: 40 }}>
        {badge}
        <T variant="body" color={colors.textSecondary} style={{ marginTop: 18, fontSize: 19, textTransform: 'uppercase' }} center>{name}</T>
        <T variant="label" color={colors.textSecondary} style={{ marginTop: 10 }}>
          Ksh. {formatAmount(amount)}  Fee:Ksh. {formatAmount(fee)}
        </T>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 44 }}>
          {[0, 1, 2, 3].map((i) => {
            const filled = i < pin.length;
            return (
              <View key={i} style={[styles.pinBox, { borderColor: filled ? colors.green : colors.mode === 'dark' ? '#7F8386' : '#D5DCE2' }]}>
                {filled ? <View style={[styles.pinDot, { backgroundColor: colors.green }]} /> : null}
              </View>
            );
          })}
        </View>
        <T variant="caption" color={colors.red} style={{ marginTop: 16, minHeight: 18 }} center>{error ?? ''}</T>
      </View>
      <View style={styles.keypad}>
        {keys.map((k, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={k === 'del' ? 'Delete' : k || undefined}
            disabled={!k || busy}
            onPress={() => (k === 'del' ? setPin((p) => p.slice(0, -1)) : press(k))}
            style={({ pressed }) => [styles.key, pressed && k ? { opacity: 0.5 } : null]}
          >
            {k === 'del' ? <BackspaceIcon size={30} /> : <Text style={{ fontSize: 34, color: colors.text }}>{k}</Text>}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

function BackChevron() {
  const { colors } = useTheme();
  return <ChevronLeftIcon color={colors.text} size={22} />;
}

// ---------------------------------------------------------------- Success

export function SuccessView({
  transaction, partyLabel, partyBadge, partyLines, actions, onDone,
}: {
  transaction: TransactionRecord;
  partyLabel: string;
  partyBadge: ReactNode;
  partyLines: string[];
  actions?: ReactNode;
  onDone: () => void;
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
        <CircleButton label="Close" onPress={onDone} size={48}><CloseIcon /></CircleButton>
        <Inert style={[styles.sharePill, { backgroundColor: colors.mode === 'dark' ? colors.surface : colors.screen, borderColor: colors.border }]}>
          <ShareIcon />
          <T variant="bodyStrong" style={{ fontWeight: '600' }}>Share Details</T>
        </Inert>
      </View>
      <BadgeCard badge={<Text style={{ fontSize: 34 }}>🎉</Text>} style={{ marginTop: 50 }}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 26, alignItems: 'center' }}>
          <T variant="title" center style={{ fontSize: 28, fontWeight: '400', lineHeight: 36 }}>Your transaction was successful</T>
          <T variant="label" color={colors.textSecondary} style={{ marginTop: 14 }}>{when}</T>
          <T variant="amount" style={{ marginTop: 18 }}>{formatKsh(transaction.amount)}</T>
          <T variant="label" color={colors.textSecondary} style={{ marginTop: 16 }}>
            Transaction cost:<Text style={{ fontWeight: '700', color: colors.textSecondary }}>{formatKsh(transaction.fee)}</Text>
          </T>
          <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel="Copy transaction ID" style={[styles.idPill, { backgroundColor: colors.mode === 'light' ? colors.greenSoft : 'transparent' }]}>
            <Text style={{ color: colors.green, fontWeight: '700', fontSize: 17 }}>ID: {transaction.reference}</Text>
            <CopyIcon size={18} />
            <Text style={{ color: colors.green, fontSize: 17 }}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
          <View style={[styles.partyBox, { backgroundColor: colors.raised }]}>
            <T variant="label">{partyLabel}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 14 }}>
              {partyBadge}
              <View style={{ flex: 1 }}>
                {partyLines.map((line, i) => (
                  <T key={i} variant="body" color={i === 2 ? colors.textSecondary : colors.text} style={{ fontSize: 17, marginTop: i ? 6 : 0 }}>{line}</T>
                ))}
              </View>
            </View>
          </View>
        </View>
      </BadgeCard>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </Screen>
  );
}

export function ResultAction({ icon, label, onPress, inert }: { icon: ReactNode; label: string; onPress?: () => void; inert?: boolean }) {
  const { colors } = useTheme();
  const content = (
    <View style={{ alignItems: 'center', width: 84 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mode === 'dark' ? colors.raised : colors.raised, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <T variant="label" center style={{ marginTop: 10 }}>{label}</T>
    </View>
  );
  if (inert || !onPress) return <Inert>{content}</Inert>;
  return <Pressable accessibilityRole="button" onPress={onPress}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  pinHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 10 },
  pinBox: { width: 58, height: 58, borderRadius: 10, borderWidth: 1.4, alignItems: 'center', justifyContent: 'center' },
  pinDot: { width: 20, height: 20, borderRadius: 10 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 'auto', marginBottom: 16 },
  key: { width: '33.33%', height: 74, alignItems: 'center', justifyContent: 'center' },
  successTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12 },
  sharePill: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  idPill: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10 },
  partyBox: { alignSelf: 'stretch', marginTop: 28, borderRadius: 12, padding: 22 },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 28 },
});
