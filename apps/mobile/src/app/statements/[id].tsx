import {
  addFavourite,
  categoryFor,
  counterpartyKey,
  describeCounterparty,
  formatKsh,
  toLocalParts,
  toLocalPhone,
  typeLabelFor,
  type SimulationType,
} from '@paspesa/core';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ResultAction } from '@/components/journey';
import { Avatar, BadgeCard, Screen, ScreenHeader, T } from '@/components/ui';
import { CopyIcon, ExportIcon, ReceiptIcon, ReverseIcon, StarFilledIcon, StarIcon } from '@/icons';
import { useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

/** Transaction detail. Every value comes from the committed record. */
export default function TransactionDetailScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { transactions, favourites, deps, refresh } = useAppState();
  const [copied, setCopied] = useState(false);
  const tx = transactions.find((t) => t.id === id);

  if (!tx) {
    return (
      <Screen>
        <ScreenHeader />
        <T variant="body" center style={{ marginTop: s(60) }}>Transaction not found.</T>
      </Screen>
    );
  }

  const { title } = describeCounterparty(tx);
  const p = toLocalParts(tx.completedAt, deps.config.utcOffsetMinutes);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const when = `${p.day}${ordinal(p.day)} ${MONTHS[p.month - 1]} ${p.year} |  ${String(h12).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}${p.hour < 12 ? 'am' : 'pm'}`;
  const c = tx.counterparty;
  const identifier =
    tx.type === 'BUY_GOODS' ? { label: 'Till Number', value: c.tillNumber ?? '' }
    : tx.type === 'PAYBILL' ? { label: 'Paybill / Account', value: `${c.paybillNumber ?? ''} / ${c.accountReference ?? ''}` }
    : tx.type === 'WITHDRAW' ? { label: 'Agent Number', value: c.agentNumber ?? '' }
    : tx.type === 'OPENING_BALANCE' ? null
    : { label: 'Phone Number', value: tx.type === 'AIRTIME' || tx.type === 'SEND_MONEY' ? c.phone ?? '' : toLocalPhone(c.phone ?? '') };

  const favKey = tx.type === 'OPENING_BALANCE' ? null : counterpartyKey(tx.type, tx.variant, c);
  const isFavourite = !!favKey && favourites.some((f) => f.type === tx.type && f.key === favKey);
  const canFavourite = tx.direction === 'DEBIT' && !!favKey;

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

  return (
    <Screen>
      <ScreenHeader />
      <BadgeCard badge={<Avatar name={title || 'Paspesa'} size={62} fontSize={22} />} style={{ marginTop: s(70) }}>
        <View style={{ alignItems: 'center', paddingHorizontal: s(20) }}>
          <View style={[styles.typeChip, { borderColor: colors.divider }]}>
            <T variant="label" color={colors.textSecondary}>{typeLabelFor(tx.type)}</T>
          </View>
          <T variant="title" center style={{ marginTop: s(16), fontSize: s(26), fontWeight: '600', textTransform: 'uppercase' }}>{title}</T>
          <T variant="amount" style={{ marginTop: s(8) }}>{tx.direction === 'CREDIT' ? '+' : '-'} {formatKsh(tx.amount)}</T>
          <View style={[styles.categoryChip, { backgroundColor: colors.greenSoft }]}>
            <T variant="label" color={colors.green} style={{ fontWeight: '500' }}>{categoryFor(tx.type)}</T>
          </View>
        </View>
        <View style={{ paddingHorizontal: s(22), paddingBottom: s(12), marginTop: s(12) }}>
          {identifier ? <DetailRow label={identifier.label} value={identifier.value} /> : null}
          <DetailRow
            label="Transaction ID"
            value={tx.reference}
            right={
              <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel="Copy transaction ID" style={[styles.copy, { backgroundColor: colors.greenSoft }]}>
                <CopyIcon size={18} />
                <T variant="label" color={colors.green}>{copied ? 'Copied' : 'Copy'}</T>
              </Pressable>
            }
          />
          <DetailRow label="Date and Time" value={when} last={tx.direction !== 'DEBIT'} />
          {tx.direction === 'DEBIT' ? <DetailRow label="Transaction Fee" value={`Total: ${formatKsh(tx.fee)}`} last /> : null}
        </View>
      </BadgeCard>

      <View style={styles.actions}>
        {canFavourite ? (
          <ResultAction icon={isFavourite ? <StarFilledIcon size={28} /> : <StarIcon size={28} />} label={isFavourite ? 'Added to\nFavourites' : 'Add to\nFavourites'} onPress={toggleFavourite} />
        ) : null}
        <ResultAction icon={<ReverseIcon size={28} />} label={'Reverse\nTransaction'} inert />
        <ResultAction icon={<ReceiptIcon size={28} />} label={'Download\nReceipt'} inert />
        <ResultAction icon={<ExportIcon size={28} />} label="Share Details" inert />
      </View>
    </Screen>
  );
}

function DetailRow({ label, value, right, last }: { label: string; value: string; right?: React.ReactNode; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.detailRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <T variant="label" color={colors.textSecondary}>{label}</T>
        <T variant="bodyStrong" style={{ fontSize: s(19), marginTop: s(6), fontWeight: '600' }}>{value}</T>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  typeChip: { borderWidth: 1.2, borderRadius: s(14), paddingHorizontal: s(26), paddingVertical: s(3) },
  categoryChip: { marginTop: s(12), borderRadius: s(16), paddingHorizontal: s(22), paddingVertical: s(6) },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(16) },
  copy: { flexDirection: 'row', alignItems: 'center', gap: s(6), paddingHorizontal: s(12), paddingVertical: s(6), borderRadius: s(10) },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: s(34) },
});
