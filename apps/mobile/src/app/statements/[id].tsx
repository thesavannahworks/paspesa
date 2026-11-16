/**
 * Transaction detail (reference-screenshots/09-statements 02, 05, 07–12). Every value comes from the
 * committed record. Sizes are measured on the references (1.4 px per unit on the 757 px captures).
 */
import {
  addFavourite,
  counterpartyKey,
  describeCounterparty,
  detailLabelsFor,
  formatAmount,
  formatKsh,
  toLocalParts,
  type SimulationType,
} from '@paspesa/core';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar, BadgeCard, CircleButton, Inert, Screen, T } from '@/components/ui';
import { ChevronDownIcon, ChevronLeftIcon, ChevronUpIcon, CopyIcon, ExportIcon, ReceiptIcon, ReverseIcon, StarFilledIcon, StarIcon } from '@/icons';
import { useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
const pad2 = (n: number) => String(n).padStart(2, '0');

/** M-PESA prints the 24-hour time with an am/pm suffix: "21:54pm", "09:16am". */
function detailWhen(iso: string, offset: number): string {
  const p = toLocalParts(iso, offset);
  return `${p.day}${ordinal(p.day)} ${MONTHS[p.month - 1]} ${p.year} |  ${pad2(p.hour)}:${pad2(p.minute)}${p.hour < 12 ? 'am' : 'pm'}`;
}

/** "Total: Ksh 0.0" (reference 05) — one decimal place. */
const feeText = (fee: number) => `Total: Ksh ${formatAmount(fee).replace(/0$/, '')}`;

export default function TransactionDetailScreen() {
  const { colors } = useTheme();
  const dark = colors.mode === 'dark';
  const { id } = useLocalSearchParams<{ id: string }>();
  const { transactions, favourites, deps, refresh } = useAppState();
  const [copied, setCopied] = useState(false);
  const [showFee, setShowFee] = useState(false);
  const tx = transactions.find((t) => t.id === id);

  const header = (
    <View style={{ paddingTop: s(21) }}>
      <CircleButton label="Back" size={52} onPress={() => router.back()}><ChevronLeftIcon color={colors.text} size={28} /></CircleButton>
    </View>
  );

  if (!tx) {
    return (
      <Screen>
        {header}
        <T variant="body" center style={{ marginTop: s(60) }}>Transaction not found.</T>
      </Screen>
    );
  }

  const { title } = describeCounterparty(tx);
  const labels = detailLabelsFor(tx);
  const c = tx.counterparty;
  const favKey = tx.type === 'OPENING_BALANCE' ? null : counterpartyKey(tx.type, tx.variant, c);
  const isFavourite = !!favKey && favourites.some((f) => f.type === tx.type && f.key === favKey);
  const canFavourite = tx.direction === 'DEBIT' && !!favKey;
  const chipBg = dark ? '#20251F' : '#F6FDF5';

  const toggleFavourite = async () => {
    if (isFavourite || !favKey) return;
    await addFavourite(deps, { type: tx.type as SimulationType, variant: tx.variant ?? undefined, counterparty: c, label: title });
    await refresh();
  };

  const copy = async () => {
    await Clipboard.setStringAsync(tx.reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const Chevron = showFee ? ChevronUpIcon : ChevronDownIcon;

  return (
    <Screen>
      {header}
      <BadgeCard
        badge={<Avatar name={title || 'Paspesa'} size={107} fontSize={28} />}
        badgeSize={110}
        contentTop={72}
        style={{ marginTop: s(97) }}
      >
        <View style={{ alignItems: 'center', paddingHorizontal: s(20) }}>
          <View style={[styles.typeChip, { borderColor: dark ? '#353740' : '#E6E6E6' }]}>
            <T variant="label" color={colors.textSecondary} style={{ fontSize: s(16.5), lineHeight: s(19) }}>{labels.chip}</T>
          </View>
          <T variant="title" center style={{ marginTop: s(22), fontSize: s(29.4), lineHeight: s(35), fontWeight: '500', textTransform: 'uppercase' }}>{title}</T>
          <T variant="amount" style={{ marginTop: s(10), fontSize: s(32), lineHeight: s(38), fontWeight: '600' }}>
            {tx.direction === 'CREDIT' ? '+' : '-'} {formatKsh(tx.amount)}
          </T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.category}
            accessibilityState={{ expanded: showFee }}
            onPress={() => setShowFee(!showFee)}
            style={[styles.categoryChip, { backgroundColor: chipBg }]}
          >
            <T variant="label" color={colors.green} style={{ fontWeight: '500', fontSize: s(16.5) }}>{labels.category}</T>
            <Chevron size={24} color={colors.green} strokeWidth={1.4} />
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: s(21), paddingBottom: s(20), marginTop: s(31) }}>
          {labels.party ? <DetailRow label="Phone Number" value={labels.party} /> : null}
          <DetailRow
            label="Transaction ID"
            value={tx.reference}
            right={
              <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel="Copy transaction ID" style={[styles.copy, { backgroundColor: chipBg }]}>
                <CopyIcon size={22} />
                <T variant="label" color={colors.green} style={{ fontSize: s(17) }}>{copied ? 'Copied' : 'Copy'}</T>
              </Pressable>
            }
          />
          <DetailRow label="Date and Time" value={detailWhen(tx.completedAt, deps.config.utcOffsetMinutes)} last={!showFee} />
          {showFee ? <DetailRow label="Transaction Fee" value={feeText(tx.fee)} last /> : null}
        </View>
      </BadgeCard>

      <View style={styles.actions}>
        {canFavourite ? (
          <DetailAction icon={isFavourite ? <StarFilledIcon size={36} /> : <StarIcon size={36} />} label={isFavourite ? 'Added to\nFavourites' : 'Add to\nFavourites'} onPress={toggleFavourite} />
        ) : null}
        <DetailAction icon={<ReverseIcon size={36} />} label={'Reverse\nTransaction'} />
        <DetailAction icon={<ReceiptIcon size={36} />} label={'Download\nReceipt'} />
        <DetailAction icon={<ExportIcon size={36} />} label="Share Details" />
      </View>
    </Screen>
  );
}

function DetailRow({ label, value, right, last }: { label: string; value: string; right?: ReactNode; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.detailRow, !last && { borderBottomWidth: 1, borderBottomColor: colors.mode === 'dark' ? '#2A2A2A' : '#EFEFEF' }]}>
      <View style={{ flex: 1 }}>
        <T variant="label" color={colors.textSecondary} style={{ fontSize: s(16.1), lineHeight: s(20) }}>{label}</T>
        <T variant="bodyStrong" style={{ fontSize: s(18.5), lineHeight: s(22), marginTop: s(2.6), fontWeight: '500' }}>{value}</T>
      </View>
      {right}
    </View>
  );
}

/**
 * Detail actions: 63-unit circles spread evenly over the full width
 * (4 actions → centres 88 / 209 / 331 / 453; 3 actions → 118 / 271 / 422, measured).
 */
function DetailAction({ icon, label, onPress }: { icon: ReactNode; label: string; onPress?: () => void }) {
  const { colors } = useTheme();
  const content = (
    <View style={{ width: s(70), alignItems: 'center' }}>
      <View style={[styles.actionCircle, { backgroundColor: colors.raised, borderColor: colors.mode === 'dark' ? 'transparent' : '#EDEDED' }]}>{icon}</View>
      <View style={{ width: s(130), alignItems: 'center' }}>
        <T variant="label" center style={{ marginTop: s(9.5), fontSize: s(16.7), lineHeight: s(21) }}>{label}</T>
      </View>
    </View>
  );
  // Reverse / Download / Share are not simulated yet: visible but inert.
  if (!onPress) return <Inert>{content}</Inert>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label.replace('\n', ' ')} onPress={onPress}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  typeChip: { borderWidth: 1.2, borderRadius: s(11), paddingHorizontal: s(21.5), paddingVertical: s(0.8) },
  categoryChip: { flexDirection: 'row', alignItems: 'center', gap: s(4), marginTop: s(10.5), height: s(26.5), borderRadius: s(13.5), paddingHorizontal: s(20) },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingTop: s(10), paddingBottom: s(11.4) },
  copy: { flexDirection: 'row', alignItems: 'center', gap: s(4), height: s(26), paddingHorizontal: s(10), borderRadius: s(13) },
  actions: { flexDirection: 'row', justifyContent: 'space-evenly', marginTop: s(41.5), marginHorizontal: -s(21) },
  actionCircle: { width: s(63), height: s(63), borderRadius: s(31.5), alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
