import { formatKsh, resetAirtimeBalance, toLocalPhone } from '@paspesa/core';
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { PrimaryButton, Screen, ScreenHeader, T } from '@/components/ui';
import { AirtimeResetIcon, ChevronRightIcon, ContactIcon, RechargeIcon } from '@/icons';
import { useAccount, useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

/**
 * Accounts / General Operations (White Paper §9.3, §10.2).
 * No reference screen was supplied; built in the reference visual language.
 */
export default function GeneralOperationsScreen() {
  const { colors } = useTheme();
  const { deps, refresh } = useAppState();
  const account = useAccount();
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sender = account.rechargeSenderDefaults ?? deps.config.defaultRechargeSender;

  const doReset = async () => {
    const res = await resetAirtimeBalance(deps);
    setConfirmReset(false);
    if (res.ok) {
      await refresh();
      setNotice(res.amountReset > 0 ? `Airtime balance reset (${formatKsh(res.amountReset)} cleared).` : 'Airtime balance is already zero.');
    } else setNotice(res.error.message);
  };

  return (
    <Screen background="page">
      <ScreenHeader title="General Operations" />
      <View style={[styles.summary, { backgroundColor: colors.surface }]}>
        <View style={{ flex: 1 }}>
          <T variant="caption" color={colors.textSecondary}>M-PESA Balance</T>
          <T variant="bodyStrong" style={{ fontSize: s(20), marginTop: s(6) }}>{formatKsh(account.currentBalanceCache)}</T>
        </View>
        <View style={{ width: s(1), backgroundColor: colors.divider, marginHorizontal: s(14) }} />
        <View style={{ flex: 1 }}>
          <T variant="caption" color={colors.textSecondary}>Airtime Balance</T>
          <T variant="bodyStrong" style={{ fontSize: s(20), marginTop: s(6) }}>{formatKsh(account.airtimeBalance)}</T>
          <T variant="caption" color={colors.textMuted} style={{ marginTop: s(2) }}>max {formatKsh(deps.config.maxAirtimeBalance)}</T>
        </View>
      </View>

      <View style={[styles.list, { backgroundColor: colors.surface }]}>
        <Item icon={<RechargeIcon size={26} />} title="Recharge account" subtitle="Add simulated funds to your M-PESA balance" href="/recharge" />
        <Item
          icon={<ContactIcon size={26} />}
          title="Default recharge sender"
          subtitle={`${sender.name} · ${toLocalPhone(sender.phone)}`}
          href="/recharge-sender"
        />
        <Item icon={<AirtimeResetIcon size={26} />} title="Reset airtime balance" subtitle="Clear the simulated airtime balance to Ksh 0" onPress={() => setConfirmReset(true)} last />
      </View>
      {notice ? <T variant="caption" color={colors.green} style={{ marginTop: s(14) }}>{notice}</T> : null}

      <Modal visible={confirmReset} transparent animationType="fade" onRequestClose={() => setConfirmReset(false)}>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
            <T variant="heading">Reset airtime balance?</T>
            <T variant="body" color={colors.textSecondary} style={{ marginTop: s(10), lineHeight: s(22) }}>
              Your simulated airtime balance of {formatKsh(account.airtimeBalance)} will be cleared to Ksh 0. Your M-PESA balance and transactions are not affected.
            </T>
            <PrimaryButton title="Reset" onPress={doReset} style={{ marginTop: s(20) }} />
            <Pressable onPress={() => setConfirmReset(false)} style={{ alignItems: 'center', paddingTop: s(16) }} accessibilityRole="button">
              <T variant="body" color={colors.green}>Cancel</T>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function Item({ icon, title, subtitle, href, onPress, last }: { icon: ReactNode; title: string; subtitle: string; href?: Href; onPress?: () => void; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress ?? (() => href && router.push(href))}
      style={({ pressed }) => [styles.item, !last && { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: colors.border }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.itemIcon, { backgroundColor: colors.raised }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" style={{ fontWeight: '600' }}>{title}</T>
        <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(4) }}>{subtitle}</T>
      </View>
      <ChevronRightIcon size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', borderRadius: s(16), padding: s(20), marginTop: s(20) },
  list: { borderRadius: s(16), marginTop: s(18), paddingHorizontal: s(16) },
  item: { flexDirection: 'row', alignItems: 'center', gap: s(14), paddingVertical: s(18) },
  itemIcon: { width: s(46), height: s(46), borderRadius: s(12), alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, justifyContent: 'center', padding: s(24) },
  dialog: { borderRadius: s(18), padding: s(22) },
});
