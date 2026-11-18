/**
 * Home in the desktop view (web on a computer, sidebar switch "Desktop"): a dashboard that uses the width —
 * balances side by side, recent activity as a table, quick actions and the latest messages — instead of the
 * phone home stretched out. The same data and journeys as the phone home; undiscussed actions stay inert.
 */
import { buildStatement, formatKsh, type StatementRow } from '@paspesa/core';
import { router, type Href } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Inert } from '@/components/ui';
import {
  AirtimeIcon, BundlesIcon, EyeIcon, EyeOffIcon, GiftIcon, HomeInternetIcon, LipaIcon, MessageIcon, PochiWalletIcon, ReceiptIcon,
  SendMoneyIcon, TokenIcon, WithdrawIcon,
} from '@/icons';
import { useApi } from '@/services/api';
import { useAccount, useAppState } from '@/services/AppState';
import { usePreference } from '@/services/preferences';
import { useRemote, type WalletView } from '@/services/wallet';
import { useTheme } from '@/theme/ThemeProvider';

const greeting = (h = new Date().getHours()) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

export function DesktopHome() {
  const { colors } = useTheme();
  const account = useAccount();
  const { transactions, messages, deps } = useAppState();
  const api = useApi();
  const wallet = useRemote<WalletView>(api.available ? '/v1/wallet' : null);
  const [hidden, setHidden] = usePreference('balanceHidden', false);
  const offset = deps.config.utcOffsetMinutes;
  const rows = useMemo(() => buildStatement(transactions, { utcOffsetMinutes: offset }).groups.flatMap((g) => g.rows.map((r) => ({ ...r, day: g.heading }))).slice(0, 8), [transactions, offset]);
  const visible = messages.filter((m) => !m.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = visible.filter((m) => !m.readAt).length;
  const firstName = account.accountName.split(' ')[0] ?? account.accountName;
  const money = (n: number) => (hidden ? 'Ksh ••••' : formatKsh(n));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.page }} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.hello, { color: colors.text }]}>{greeting()}, {firstName}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 4 }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </View>
        <HeadButton label="Send Money" primary onPress={() => router.push('/send-money')} />
        <HeadButton label="Lipa na M-PESA" onPress={() => router.push('/lipa')} />
        <HeadButton label="Airtime" onPress={() => router.push('/airtime')} />
      </View>

      <View style={styles.cards}>
        <Card label="M-PESA Balance" accent={colors.green} action={
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'} onPress={() => setHidden(!hidden)} hitSlop={8}>
            {hidden ? <EyeOffIcon size={20} color={colors.textSecondary} /> : <EyeIcon size={20} color={colors.textSecondary} />}
          </Pressable>
        }>
          <Text style={[styles.big, { color: colors.text }]}>{money(account.currentBalanceCache)}</Text>
          <Link label="View statements" href="/statements" />
        </Card>
        <Card label="Airtime">
          <Text style={[styles.big, { color: colors.text }]}>{formatKsh(account.airtimeBalance)}</Text>
          <Link label="Buy airtime" href="/airtime" />
        </Card>
        <Card label="Paspesa Tokens">
          <Text style={[styles.big, { color: colors.text }]}>
            {wallet.data ? `${wallet.data.balances.total} tokens` : api.available ? '—' : 'Offline'}
          </Text>
          <Link label="Manage tokens" href="/wallet" />
        </Card>
        <Card label="Messages">
          <Text style={[styles.big, { color: colors.text }]}>{unread ? `${unread} unread` : 'All read'}</Text>
          <Link label="Open messages" href="/messages" />
        </Card>
      </View>

      <View style={styles.columns}>
        <View style={[styles.panel, { flex: 2, minWidth: 460, backgroundColor: colors.surface, borderColor: colors.divider }]}>
          <View style={styles.panelHead}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>Recent activity</Text>
            <Link label="All statements" href="/statements" />
          </View>
          {rows.length ? (
            <>
              <View style={[styles.tr, { borderBottomColor: colors.divider }]}>
                {['Details', 'Date', 'Amount', 'Balance'].map((h, i) => (
                  <Text key={h} style={[styles.th, { color: colors.textSecondary }, i === 0 ? { flex: 2.4 } : i >= 2 ? styles.num : null]}>{h}</Text>
                ))}
              </View>
              {rows.map((r) => <ActivityRow key={r.transactionId} row={r} hidden={hidden} />)}
            </>
          ) : (
            <Text style={{ color: colors.textSecondary, paddingVertical: 24 }}>No transactions yet. Send money or recharge to get started.</Text>
          )}
        </View>

        <View style={{ flex: 1, minWidth: 300, gap: 20 }}>
          <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            <Text style={[styles.panelTitle, { color: colors.text, marginBottom: 12 }]}>Quick actions</Text>
            <View style={styles.grid}>
              <Action label="Send Money" icon={<SendMoneyIcon size={26} />} href="/send-money" />
              <Action label="Lipa na M-PESA" icon={<LipaIcon size={26} />} href="/lipa" />
              <Action label="Airtime" icon={<AirtimeIcon size={26} />} href="/airtime" />
              <Action label="Statements" icon={<ReceiptIcon size={26} />} href="/statements" />
              <Action label="Tokens" icon={<TokenIcon size={26} />} href="/wallet" />
              <Action label="Withdraw" icon={<WithdrawIcon size={26} />} />
              <Action label="Pochi Wallet" icon={<PochiWalletIcon size={26} />} />
              <Action label="Bundles" icon={<BundlesIcon size={24} />} />
              <Action label="Tunukiwa" icon={<GiftIcon size={26} />} />
              <Action label="Home Internet" icon={<HomeInternetIcon size={26} />} />
            </View>
          </View>
          <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            <View style={styles.panelHead}>
              <Text style={[styles.panelTitle, { color: colors.text }]}>Latest messages</Text>
              <Link label="All messages" href="/messages" />
            </View>
            {visible.slice(0, 4).map((m) => (
              <Pressable key={m.id} accessibilityRole="link" onPress={() => router.push('/messages')}
                style={({ hovered }) => [styles.msg, { borderTopColor: colors.divider, backgroundColor: hovered ? colors.raised : 'transparent' }]}>
                <MessageIcon size={20} />
                <Text numberOfLines={2} style={{ flex: 1, marginLeft: 10, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: m.readAt ? '400' : '600' }}>{m.body}</Text>
              </Pressable>
            ))}
            {visible.length ? null : <Text style={{ color: colors.textSecondary, paddingVertical: 12 }}>No messages yet.</Text>}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function ActivityRow({ row, hidden }: { row: StatementRow & { day: string }; hidden: boolean }) {
  const { colors } = useTheme();
  const credit = row.signedAmount > 0;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/statements/[id]', params: { id: row.transactionId } })}
      style={({ hovered }) => [styles.tr, { borderBottomColor: colors.divider, backgroundColor: hovered ? colors.raised : 'transparent' }]}
    >
      <View style={{ flex: 2.4, flexDirection: 'row', alignItems: 'center' }}>
        <UserAvatarLite name={row.title} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>{row.title}</Text>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{row.category}</Text>
        </View>
      </View>
      <Text style={[styles.td, { color: colors.textSecondary }]}>{row.day} · {row.time}</Text>
      <Text style={[styles.td, styles.num, { color: credit ? colors.green : colors.text, fontWeight: '600' }]}>
        {hidden ? '••••' : `${credit ? '+' : '−'} ${formatKsh(Math.abs(row.signedAmount))}`}
      </Text>
      <Text style={[styles.td, styles.num, { color: colors.textSecondary }]}>{hidden ? '••••' : formatKsh(row.balanceAfter)}</Text>
    </Pressable>
  );
}

/** Small initials circle for a table row (the account's own photo is not used for other people). */
function UserAvatarLite({ name }: { name: string }) {
  const { colors } = useTheme();
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '')).toUpperCase() || 'P';
  return (
    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.green, fontWeight: '600', fontSize: 12 }}>{initials}</Text>
    </View>
  );
}

function Card({ label, accent, action, children }: { label: string; accent?: string; action?: ReactNode; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.divider, borderLeftColor: accent ?? colors.divider, borderLeftWidth: accent ? 3 : StyleSheet.hairlineWidth }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>{label}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function Link({ label, href }: { label: string; href: Href }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(href)} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
      {({ hovered }) => <Text style={{ color: colors.green, fontSize: 13, fontWeight: '500', textDecorationLine: hovered ? 'underline' : 'none' }}>{label}</Text>}
    </Pressable>
  );
}

function HeadButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ hovered }) => [styles.headBtn, primary
        ? { backgroundColor: colors.green, opacity: hovered ? 0.9 : 1 }
        : { borderWidth: 1, borderColor: colors.divider, backgroundColor: hovered ? colors.raised : colors.surface }]}>
      <Text style={{ color: primary ? '#FFFFFF' : colors.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function Action({ label, icon, href }: { label: string; icon: ReactNode; href?: Href }) {
  const { colors } = useTheme();
  const body = (
    <>
      <View style={[styles.actionIcon, { backgroundColor: colors.raised }]}>{icon}</View>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, marginTop: 6 }}>{label}</Text>
    </>
  );
  // Undiscussed journeys stay visible but do nothing (owner rule).
  if (!href) return <Inert style={styles.action}>{body}</Inert>;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={() => router.push(href)}
      style={({ hovered }) => [styles.action, { backgroundColor: hovered ? colors.raised : 'transparent', borderRadius: 10 }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 22 },
  hello: { fontSize: 26, fontWeight: '700' },
  headBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { flex: 1, minWidth: 200, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  big: { fontSize: 24, fontWeight: '700', marginTop: 10 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 20, alignItems: 'flex-start' },
  panel: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  panelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
  panelTitle: { fontSize: 16, fontWeight: '700' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 6 },
  th: { flex: 1, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  td: { flex: 1, fontSize: 13 },
  num: { textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { width: '25%', minWidth: 72, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2 },
  actionIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  msg: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth },
});
