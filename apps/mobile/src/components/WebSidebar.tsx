/**
 * Navigation for the web on a wide screen (see LayoutFrame). Phones navigate from the home screen as
 * before; on a computer the main places are one click away.
 */
import { router, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UserAvatar } from '@/components/UserAvatar';
import { AirtimeIcon, LipaIcon, MessageIcon, PersonIcon, ReceiptIcon, SendMoneyIcon, TokenIcon, WalletIcon } from '@/icons';
import { useAppState } from '@/services/AppState';
import { syncNow, useSyncStatus } from '@/services/sync';
import { useTheme } from '@/theme/ThemeProvider';
import { SIDEBAR_WIDTH } from './LayoutFrame';

const HOME_ICON = (color: string) => (
  <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 16, height: 13, borderWidth: 2, borderColor: color, borderTopWidth: 0, borderRadius: 2, marginTop: 6 }} />
    <View style={{ position: 'absolute', top: 1, width: 13, height: 13, borderLeftWidth: 2, borderTopWidth: 2, borderColor: color, transform: [{ rotate: '45deg' }] }} />
  </View>
);

interface Item { label: string; href: Href; icon: (color: string) => ReactNode; match: (path: string) => boolean }

const ITEMS: Item[] = [
  { label: 'Home', href: '/', icon: HOME_ICON, match: (p) => p === '/' },
  { label: 'Send Money', href: '/send-money', icon: () => <SendMoneyIcon size={22} />, match: (p) => p.startsWith('/send-money') },
  { label: 'Lipa na M-PESA', href: '/lipa', icon: () => <LipaIcon size={22} />, match: (p) => p.startsWith('/lipa') },
  { label: 'Airtime Top Up', href: '/airtime', icon: () => <AirtimeIcon size={22} />, match: (p) => p.startsWith('/airtime') },
  { label: 'Messages', href: '/messages', icon: () => <MessageIcon size={22} />, match: (p) => p.startsWith('/messages') },
  { label: 'Statements', href: '/statements', icon: () => <ReceiptIcon size={22} />, match: (p) => p.startsWith('/statements') },
  { label: 'Paspesa Tokens', href: '/wallet', icon: () => <TokenIcon size={22} />, match: (p) => p.startsWith('/wallet') },
  { label: 'General Operations', href: '/general-operations', icon: () => <WalletIcon size={22} />, match: (p) => p.startsWith('/general-operations') || p.startsWith('/recharge') },
  { label: 'Profile', href: '/profile', icon: () => <PersonIcon size={22} />, match: (p) => p.startsWith('/profile') || p.startsWith('/account-details') || p.startsWith('/change-pin') || p.startsWith('/biometrics') },
];

export function WebSidebar() {
  const { colors } = useTheme();
  const path = usePathname();
  const { account, messages } = useAppState();
  const unread = messages.filter((m) => !m.readAt && !m.deletedAt).length;
  return (
    <View style={[styles.side, { backgroundColor: colors.surface, borderRightColor: colors.divider }]}>
      <Text style={[styles.brand, { color: colors.green }]}>Paspesa</Text>
      <View style={{ gap: 2 }}>
        {ITEMS.map((item) => {
          const on = item.match(path);
          return (
            <Pressable
              key={item.label}
              accessibilityRole="link"
              accessibilityState={{ selected: on }}
              onPress={() => (item.href === '/' ? router.dismissTo('/') : router.navigate(item.href))}
              style={({ hovered }) => [styles.item, { backgroundColor: on ? colors.greenSoft : hovered ? colors.raised : 'transparent' }]}
            >
              <View style={styles.icon}>{item.icon(colors.green)}</View>
              <Text style={[styles.label, { color: on ? colors.green : colors.text, fontWeight: on ? '600' : '400' }]}>{item.label}</Text>
              {item.label === 'Messages' && unread ? (
                <View style={[styles.badge, { backgroundColor: colors.red }]}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      {account ? (
        <View style={[styles.me, { borderTopColor: colors.divider }]}>
          <UserAvatar size={40} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{account.accountName}</Text>
            <BackupLine />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function BackupLine() {
  const { colors } = useTheme();
  const { refresh } = useAppState();
  const st = useSyncStatus();
  const [busy, setBusy] = useState(false);
  if (!st?.enabled) return <Text style={[styles.small, { color: colors.textSecondary }]}>Offline mode</Text>;
  const text = st.running || busy ? 'Backing up…'
    : st.outOfStep ? 'Out of step — see Profile'
    : st.needsReview ? `${st.needsReview} waiting for review`
    : st.waiting ? `${st.waiting} waiting${st.lastError ? ' (offline)' : ''}`
    : st.lastSyncedAt ? 'Backed up' : 'Not connected yet';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back up now"
      disabled={busy || st.running}
      onPress={async () => {
        setBusy(true);
        try { await syncNow(); await refresh(); } finally { setBusy(false); }
      }}
    >
      <Text style={[styles.small, { color: st.outOfStep || st.needsReview ? colors.red : colors.textSecondary }]}>{text} · <Text style={{ color: colors.green }}>Back up now</Text></Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  side: { width: SIDEBAR_WIDTH, paddingHorizontal: 14, paddingTop: 22, paddingBottom: 14, borderRightWidth: StyleSheet.hairlineWidth },
  brand: { fontSize: 26, fontWeight: '700', paddingHorizontal: 12, marginBottom: 22 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  icon: { width: 26, alignItems: 'center' },
  label: { marginLeft: 12, fontSize: 15, flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  me: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 12, marginTop: 2 },
});
