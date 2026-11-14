import { favouritesFor, formatKsh, type FavouriteSuggestion, type SimulationType } from '@paspesa/core';
import { Redirect, router, type Href } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, CircleButton, EdgeCard, Inert, OutlineButton, SegmentedTabs, T } from '@/components/ui';
import {
  AirtimeIcon, BellIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, EmptyActivityArt, EyeIcon, EyeOffIcon, GiftIcon,
  HomeInternetIcon, LipaIcon, PlaceholderBrandMark, PlaceholderWalletMark, ScanIcon, SearchIcon, SendMoneyIcon, WithdrawIcon,
} from '@/icons';
import { useAppState } from '@/services/AppState';
import { usePreference } from '@/services/preferences';
import { useTheme } from '@/theme/ThemeProvider';

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

interface QuickAction {
  label: string;
  icon: ReactNode;
  /** Undefined = inert (no agreed behaviour yet, or journey not built yet). */
  href?: Href;
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const { account, transactions, messages, favourites, deps } = useAppState();
  const [hidden, setHidden] = usePreference('balanceHidden', false);
  const [frequentsOpen, setFrequentsOpen] = usePreference('frequentsOpen', true);
  const [tab, setTab] = useState<'apps' | 'send' | 'pay' | 'bundles'>('send');
  const [page, setPage] = useState(0);
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width, 520) - 70;

  const frequents = useMemo(() => {
    const t = deps.config.frequentThreshold;
    return {
      send: favouritesFor(['SEND_MONEY', 'POCHI'], favourites, transactions, t),
      pay: favouritesFor(['PAYBILL', 'BUY_GOODS'], favourites, transactions, t),
    };
  }, [favourites, transactions, deps.config.frequentThreshold]);

  if (!account) return <Redirect href="/setup" />;

  const firstName = account.accountName.split(' ')[0] ?? account.accountName;
  const unread = messages.some((m) => !m.readAt);

  const quickActions: QuickAction[] = [
    { label: 'Send\nMoney', icon: <SendMoneyIcon size={33} /> },
    { label: 'Lipa na\nM-PESA', icon: <LipaIcon size={33} /> },
    { label: 'Withdraw\nMoney', icon: <WithdrawIcon size={33} /> },
    { label: 'Pochi\nWallet', icon: <PlaceholderWalletMark size={32} /> },
    { label: 'Buy\nBundles', icon: <PlaceholderBrandMark size={32} label="PM" /> },
    { label: 'Airtime\nTop Up', icon: <AirtimeIcon size={33} /> },
    { label: 'Tunukiwa\nBundles', icon: <GiftIcon size={33} /> },
    { label: 'Home\nInternet', icon: <HomeInternetIcon size={33} /> },
  ];

  const onPagerScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / (cardWidth + 12)));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.header, borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => router.push('/profile')} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Avatar name={account.accountName} size={52} />
          <View style={{ marginLeft: 14 }}>
            <T variant="body" color={colors.textSecondary} style={{ fontSize: 18 }}>{greeting()}</T>
            <T variant="body" style={{ fontSize: 20, marginTop: 2 }}>{firstName} 👋</T>
          </View>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View>
            <CircleButton label="Messages" size={48} onPress={() => router.push('/messages')}><BellIcon size={26} /></CircleButton>
            {unread ? <View style={[styles.dot, { backgroundColor: colors.red }]} /> : null}
          </View>
          <Inert><CircleButton label="Search" size={48}><SearchIcon size={26} /></CircleButton></Inert>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Balance cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + 12}
          decelerationRate="fast"
          onMomentumScrollEnd={onPagerScroll}
          onScroll={onPagerScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 22, gap: 12 }}
        >
          <EdgeCard style={{ width: cardWidth }}>
            <T variant="label" color={colors.green} style={{ fontWeight: '600', fontSize: 16 }}>M-PESA Balance</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, minHeight: 44 }}>
              {hidden ? (
                <View style={[styles.blurBar, { width: 150, backgroundColor: colors.raised }]} />
              ) : (
                <T variant="amount" style={{ fontWeight: '500', fontSize: 31 }}>{formatKsh(account.currentBalanceCache)}</T>
              )}
              <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'} onPress={() => setHidden(!hidden)} hitSlop={10} style={{ marginLeft: 22 }}>
                {hidden ? <EyeIcon size={34} /> : <EyeOffIcon size={34} />}
              </Pressable>
            </View>
            <View style={{ height: 22 }} />
            <OutlineButton title="View Statements" onPress={() => router.push('/statements')} />
          </EdgeCard>

          <EdgeCard style={{ width: cardWidth }}>
            <T variant="label" color={colors.green} style={{ fontWeight: '600', fontSize: 16 }}>My Balances</T>
            <View style={{ flexDirection: 'row', marginTop: 16, minHeight: 66 }}>
              <View style={{ flex: 1 }}>
                <T variant="body" style={{ fontSize: 18 }}>Airtime</T>
                <T variant="body" style={{ fontSize: 22, marginTop: 10, fontWeight: '500' }}>Ksh. {account.airtimeBalance.toLocaleString('en-US')}</T>
              </View>
              <View style={{ width: 1, backgroundColor: colors.divider, marginHorizontal: 16 }} />
              <Inert style={{ flex: 1 }}>
                <T variant="body" style={{ fontSize: 18 }}>Bonga</T>
                <T variant="body" style={{ fontSize: 22, marginTop: 10, fontWeight: '500' }}>0 Points</T>
              </Inert>
            </View>
            <Inert><OutlineButton title="View All Balances" /></Inert>
          </EdgeCard>
        </ScrollView>
        <View style={styles.dots}>
          {[0, 1].map((i) => (
            <View key={i} style={[styles.pageDot, { width: i === page ? 36 : 22, backgroundColor: i === page ? colors.green : colors.mode === 'dark' ? '#4A5160' : '#D5DCE2' }]} />
          ))}
        </View>

        {/* Quick actions */}
        <View style={[styles.panel, { backgroundColor: colors.surface }]}>
          <View style={styles.panelHeader}>
            <T variant="heading" style={{ fontSize: 19 }}>Quick Actions</T>
            <Inert style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <T variant="body" color={colors.green} style={{ fontSize: 19 }}>View all</T>
              <ChevronRightIcon size={18} color={colors.green} />
            </Inert>
          </View>
          <View style={styles.grid}>
            {quickActions.map((qa) => {
              const tile = (
                <View style={{ alignItems: 'center' }}>
                  <View style={[styles.qaCircle, { backgroundColor: colors.raised }]}>{qa.icon}</View>
                  <Text style={{ color: colors.text, fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>{qa.label}</Text>
                </View>
              );
              return (
                <View key={qa.label} style={styles.gridCell}>
                  {qa.href ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={qa.label.replace('\n', ' ')} onPress={() => router.push(qa.href!)}>{tile}</Pressable>
                  ) : (
                    <Inert>{tile}</Inert>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Frequents */}
        <View style={[styles.panel, { backgroundColor: colors.surface }]}>
          <Pressable style={styles.panelHeader} onPress={() => setFrequentsOpen(!frequentsOpen)} accessibilityRole="button" accessibilityState={{ expanded: frequentsOpen }}>
            <T variant="heading" style={{ fontSize: 19 }}>Frequents</T>
            {frequentsOpen ? <ChevronUpIcon color={colors.text} /> : <ChevronDownIcon color={colors.text} />}
          </Pressable>
          {frequentsOpen ? (
            <View style={{ marginTop: 18 }}>
              <SegmentedTabs
                value={tab}
                onChange={setTab}
                tabs={[{ key: 'apps', label: 'Apps' }, { key: 'send', label: 'Send' }, { key: 'pay', label: 'Pay' }, { key: 'bundles', label: 'Bundles' }]}
              />
              <View style={{ marginTop: 20, minHeight: 120 }}>
                {tab === 'apps' ? (
                  <View style={{ flexDirection: 'row', gap: 18 }}>
                    <AppTile label={'ZiiDi Invest\n& Save'} mark="Zi" />
                    <AppTile label="ShirikiPay" mark="S" />
                  </View>
                ) : tab === 'bundles' ? (
                  <EmptyFrequents action="Buy Bundles Now" />
                ) : (
                  <FrequentList items={tab === 'send' ? frequents.send : frequents.pay} />
                )}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Floating scan-to-pay (inert, as referenced) */}
      <Inert style={[styles.scanPill, { backgroundColor: colors.mode === 'dark' ? colors.raised : colors.screen, shadowColor: '#000' }]}>
        <ScanIcon size={30} />
        <T variant="body" style={{ fontSize: 19, marginLeft: 14 }}>Scan to pay</T>
      </Inert>
    </SafeAreaView>
  );
}

function AppTile({ label, mark }: { label: string; mark: string }) {
  return (
    <Inert style={{ alignItems: 'center', width: 110 }}>
      <PlaceholderBrandMark size={46} label={mark} />
      <T variant="label" center style={{ marginTop: 8 }}>{label}</T>
    </Inert>
  );
}

const TYPE_LABEL: Partial<Record<SimulationType, string>> = {
  SEND_MONEY: 'Send Money', POCHI: 'Pochi la Biashara', PAYBILL: 'Paybill', BUY_GOODS: 'Buy Goods',
};

function FrequentList({ items }: { items: FavouriteSuggestion[] }) {
  const { colors } = useTheme();
  if (items.length === 0) return <EmptyFrequents />;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {items.map((f) => (
        <View key={`${f.type}|${f.key}`} style={{ alignItems: 'center', width: 112 }}>
          <Avatar name={f.label} size={52} fontSize={17} />
          <T variant="body" center numberOfLines={2} style={{ marginTop: 10, fontSize: 17, fontWeight: '500' }}>{f.label}</T>
          <T variant="caption" color={colors.textSecondary} style={{ marginTop: 4 }}>{TYPE_LABEL[f.type] ?? ''}</T>
        </View>
      ))}
    </ScrollView>
  );
}

function EmptyFrequents({ action }: { action?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 130, alignItems: 'center' }}>
        <EmptyActivityArt width={120} />
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <T variant="label" style={{ textAlign: 'right', lineHeight: 22 }}>It looks like you're starting fresh here.</T>
        {action ? <Inert><T variant="label" color={colors.green} style={{ marginTop: 14 }}>{action}</T></Inert> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { position: 'absolute', top: 2, right: 2, width: 12, height: 12, borderRadius: 6 },
  blurBar: { height: 30, borderRadius: 8, opacity: 0.9 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 18 },
  pageDot: { height: 5, borderRadius: 3 },
  panel: { marginHorizontal: 16, marginTop: 22, borderRadius: 18, padding: 20 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 18 },
  gridCell: { width: '25%', alignItems: 'center', marginBottom: 14 },
  qaCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  scanPill: {
    position: 'absolute', right: 16, bottom: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16,
    borderRadius: 16, elevation: 6, shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
});
