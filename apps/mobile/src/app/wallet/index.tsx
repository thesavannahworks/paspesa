/**
 * Profile → Paspesa Tokens (White Paper §26–29). The token balance (one wallet, by source), tokens set aside on
 * this phone for offline use, and the way to buy tokens and see history. Paspesa's own screen (no M-PESA
 * reference); styled with the app's cards and sheets.
 */
import { adoptAllocation, setTokenAllocation, type ServerAllocation } from '@paspesa/core';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { EdgeCard, Field, OutlineButton, PrimaryButton, Screen, ScreenHeader, Sheet, T } from '@/components/ui';
import { ChevronRightIcon, ReceiptIcon, SpendIcon, TokenIcon, WalletIcon } from '@/icons';
import { ApiError, useApi } from '@/services/api';
import { useAccount, useAppState } from '@/services/AppState';
import { kickSync } from '@/services/sync';
import { CATEGORY_LABEL, shortDate, useRemote, type CurrentAllocation, type WalletView } from '@/services/wallet';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

export default function WalletScreen() {
  const { colors } = useTheme();
  const api = useApi();
  const { deps, refresh } = useAppState();
  const account = useAccount();
  const wallet = useRemote<WalletView>(api.available ? '/v1/wallet' : null);
  const current = useRemote<CurrentAllocation>(api.available ? '/v1/allocations/current' : null);
  const [setAsideOpen, setSetAsideOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const local = account.tokenAllocation ?? null;
  const total = wallet.data?.balances.total ?? 0;

  const adopt = async (allocation: ServerAllocation | null) => {
    await adoptAllocation(deps, allocation);
    await refresh();
  };

  const giveBack = async () => {
    setNotice(null);
    try {
      const res = await api.post<{ released: number }>('/v1/allocations/release', { deviceRemaining: local?.remaining ?? 0 });
      await setTokenAllocation(deps, null);
      await refresh();
      setNotice(`${res.released} token${res.released === 1 ? '' : 's'} returned to your balance.`);
      void wallet.reload();
      void current.reload();
    } catch (e) {
      kickSync();
      setNotice(e instanceof ApiError ? e.message : 'Could not return the tokens. Please try again.');
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Paspesa Tokens" />

      {!api.available ? (
        <T variant="body" color={colors.textSecondary} style={{ marginTop: s(16), lineHeight: s(22) }}>
          Buying tokens and your token balance need the Paspesa server. Simulations are free in this version.
        </T>
      ) : null}

      <EdgeCard style={{ marginTop: s(22) }}>
        <T variant="label" color={colors.green} style={{ fontWeight: '600', fontSize: s(16) }}>Token Balance</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: s(12) }}>
          {wallet.loading && !wallet.data ? <ActivityIndicator color={colors.green} /> : (
            <T variant="amount" style={{ fontWeight: '500', fontSize: s(26) }}>{total} token{total === 1 ? '' : 's'}</T>
          )}
        </View>
        <T variant="label" color={colors.textSecondary} style={{ marginTop: s(6), fontSize: s(15) }}>1 token = Ksh 1 · a Ksh 100 simulation costs 20 tokens</T>
        {wallet.data ? (
          <View style={styles.breakdown}>
            {(['PURCHASED', 'PROMOTIONAL', 'ADMIN'] as const).map((k) => (
              <View key={k} style={{ flex: 1 }}>
                <T variant="caption" color={colors.textSecondary}>{CATEGORY_LABEL[k]}</T>
                <T variant="bodyStrong" style={{ fontSize: s(17), marginTop: s(2) }}>{wallet.data!.balances[k]}</T>
              </View>
            ))}
          </View>
        ) : null}
        {wallet.error ? <T variant="caption" color={colors.red} style={{ marginTop: s(10) }}>{wallet.error}</T> : null}
        <View style={{ marginTop: s(16) }}>
          <PrimaryButton title="Buy Tokens" onPress={() => router.push('/wallet/buy')} disabled={!api.available} />
        </View>
      </EdgeCard>

      <View style={[styles.card, { backgroundColor: colors.surface, marginTop: s(18) }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[styles.icon, { backgroundColor: colors.raised }]}><WalletIcon size={26} /></View>
          <View style={{ flex: 1, marginLeft: s(14) }}>
            <T variant="bodyStrong" style={{ fontSize: s(17) }}>On this phone</T>
            <T variant="label" color={colors.textSecondary} style={{ marginTop: s(3), fontSize: s(15) }}>
              {local
                ? `${local.remaining} token${local.remaining === 1 ? '' : 's'} set aside · works offline until ${shortDate(local.authorizationExpiresAt)}`
                : 'Set tokens aside to pay for simulations without internet'}
            </T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: s(12), marginTop: s(14) }}>
          <View style={{ flex: 1 }}><OutlineButton title="Set Aside" onPress={() => setSetAsideOpen(true)} /></View>
          {local ? <View style={{ flex: 1 }}><OutlineButton title="Return" onPress={() => void giveBack()} /></View> : null}
        </View>
        {notice ? <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(10) }}>{notice}</T> : null}
      </View>

      <T variant="heading" style={{ marginTop: s(30), fontSize: s(20) }}>History</T>
      <Row icon={<ReceiptIcon size={26} />} label="Purchases" sub="Token purchases and simulation payments" href="/wallet/history?tab=purchases" />
      <Row icon={<SpendIcon size={26} />} label="Spending" sub="Tokens used, refunded or expired" href="/wallet/history?tab=spending" />
      <Row icon={<TokenIcon size={26} />} label="All token activity" sub="Every movement in your token wallet" href="/wallet/history?tab=all" />

      <SetAsideSheet
        visible={setAsideOpen}
        available={total}
        onClose={() => setSetAsideOpen(false)}
        onDone={async (allocation) => {
          setSetAsideOpen(false);
          await adopt(allocation);
          void wallet.reload();
          void current.reload();
        }}
      />
    </Screen>
  );
}

function Row({ icon, label, sub, href }: { icon: React.ReactNode; label: string; sub: string; href: Href }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(href)} style={[styles.row, { borderBottomColor: colors.divider }]}>
      <View style={[styles.icon, { backgroundColor: colors.raised }]}>{icon}</View>
      <View style={{ flex: 1, marginLeft: s(14) }}>
        <T variant="body" style={{ fontSize: s(17) }}>{label}</T>
        <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(2) }}>{sub}</T>
      </View>
      <ChevronRightIcon size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

function SetAsideSheet({ visible, available, onClose, onDone }: { visible: boolean; available: number; onClose: () => void; onDone: (a: ServerAllocation) => Promise<void> }) {
  const { colors } = useTheme();
  const api = useApi();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const quantity = Number(value.replace(/\D/g, ''));
    if (!quantity) return setError('Enter how many tokens to set aside');
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ allocation: ServerAllocation }>('/v1/allocations', { quantity });
      setValue('');
      await onDone(res.allocation);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not set the tokens aside. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title="Set Aside Tokens" onClose={onClose}>
      <T variant="body" color={colors.textSecondary} style={{ marginTop: s(12), fontSize: s(15.5), lineHeight: s(21) }}>
        Tokens set aside on this phone pay for simulations offline. Other phones cannot use them until you return them.
      </T>
      <Field label="Tokens" value={value} onChangeText={(v) => { setValue(v); setError(null); }} placeholder="0" keyboardType="number-pad" hint={`${available} available`} error={error ?? undefined} />
      <Pressable accessibilityRole="button" onPress={() => setValue(String(available))} style={{ marginTop: s(8) }}>
        <T variant="label" color={colors.green}>Use all {available}</T>
      </Pressable>
      <PrimaryButton title="Set Aside" onPress={() => void submit()} loading={busy} style={{ marginTop: s(18) }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  breakdown: { flexDirection: 'row', marginTop: s(14), gap: s(8) },
  card: { borderRadius: s(14), padding: s(18) },
  icon: { width: s(46), height: s(46), borderRadius: s(23), alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(14), borderBottomWidth: StyleSheet.hairlineWidth },
});
