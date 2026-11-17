/**
 * Token history: purchases (payments), spending (simulations, refunds, expiry) and all wallet activity (§28.1).
 */
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Screen, ScreenHeader, SegmentedTabs, T } from '@/components/ui';
import { useApi } from '@/services/api';
import { CATEGORY_LABEL, ENTRY_LABEL, SPENDING_ENTRIES, shortDate, useRemote, type PaymentView, type WalletView } from '@/services/wallet';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

type Tab = 'purchases' | 'spending' | 'all';

const STATUS: Record<PaymentView['status'], string> = { INITIATED: 'Started', PENDING: 'Waiting', SUCCESSFUL: 'Paid', FAILED: 'Not completed' };

export default function TokenHistoryScreen() {
  const { colors } = useTheme();
  const api = useApi();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'spending' || params.tab === 'all' ? params.tab : 'purchases');
  const payments = useRemote<{ payments: PaymentView[] }>(api.available ? '/v1/payments' : null);
  const wallet = useRemote<WalletView>(api.available ? '/v1/wallet' : null);
  const loading = tab === 'purchases' ? payments.loading && !payments.data : wallet.loading && !wallet.data;
  const error = tab === 'purchases' ? payments.error : wallet.error;
  const entries = (wallet.data?.ledger ?? []).filter((e) => tab === 'all' || SPENDING_ENTRIES.has(e.type));

  return (
    <Screen>
      <ScreenHeader title="Token History" />
      <View style={{ marginTop: s(10) }}>
        <SegmentedTabs compact value={tab} onChange={setTab} tabs={[{ key: 'purchases', label: 'Purchases' }, { key: 'spending', label: 'Spending' }, { key: 'all', label: 'All' }]} />
      </View>
      {!api.available ? <T variant="body" color={colors.textSecondary} style={{ marginTop: s(24) }}>History needs the Paspesa server.</T> : null}
      {loading ? <ActivityIndicator color={colors.green} style={{ marginTop: s(40) }} /> : null}
      {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(20) }}>{error}</T> : null}

      {tab === 'purchases'
        ? (payments.data?.payments ?? []).map((p) => (
            <View key={p.id} style={[styles.row, { borderBottomColor: colors.divider }]}>
              <View style={{ flex: 1 }}>
                <T variant="body" style={{ fontSize: s(17) }}>{p.paymentType === 'TOKEN_PURCHASE' ? `${p.tokens} tokens` : 'Simulation payment'}</T>
                <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(3) }}>
                  {shortDate(p.createdAt)} · {p.provider}{p.refundStatus === 'REFUNDABLE_CREDIT' ? ' · refundable credit' : ''}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T variant="bodyStrong" style={{ fontSize: s(16) }}>Ksh {p.amount}</T>
                <T variant="caption" color={p.status === 'SUCCESSFUL' ? colors.green : p.status === 'FAILED' ? colors.red : colors.textSecondary}>{STATUS[p.status]}</T>
              </View>
            </View>
          ))
        : entries.map((e, i) => (
            <View key={`${e.reference}-${e.type}-${i}`} style={[styles.row, { borderBottomColor: colors.divider }]}>
              <View style={{ flex: 1 }}>
                <T variant="body" style={{ fontSize: s(17) }}>{ENTRY_LABEL[e.type] ?? e.type}</T>
                <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(3) }}>{shortDate(e.at)} · {CATEGORY_LABEL[e.category] ?? e.category}</T>
              </View>
              <T variant="bodyStrong" color={e.direction === 'CREDIT' ? colors.green : colors.text} style={{ fontSize: s(16) }}>
                {e.direction === 'CREDIT' ? '+' : '−'}{e.quantity}
              </T>
            </View>
          ))}
      {!loading && !error && api.available && (tab === 'purchases' ? payments.data?.payments.length === 0 : wallet.data && entries.length === 0) ? (
        <T variant="body" color={colors.textSecondary} center style={{ marginTop: s(40) }}>Nothing here yet.</T>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(14), borderBottomWidth: StyleSheet.hairlineWidth },
});
