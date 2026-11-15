import { favouritesFor, formatKsh, toLocalPhone, type FavouriteSuggestion, type SimulationType } from '@paspesa/core';
import { Redirect, router, type Href } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, CircleButton, EdgeCard, Inert, OutlineButton, SegmentedTabs, T } from '@/components/ui';
import {
  AirtimeIcon, BellIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, EmptyActivityArt, EyeIcon, EyeOffIcon, GiftIcon,
  HomeInternetIcon, LipaIcon, BundlesIcon, InvestIcon, PochiWalletIcon, SharedPayIcon, ScanIcon, SearchIcon, SendMoneyIcon, WithdrawIcon,
} from '@/icons';
import { useAppState } from '@/services/AppState';
import { usePreference } from '@/services/preferences';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

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
  const [scanCollapsed, setScanCollapsed] = useState(false);
  const lastScrollY = useRef(0);
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width, 520) - s(136);

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
    { label: 'Send\nMoney', icon: <SendMoneyIcon size={33} />, href: '/send-money' },
    { label: 'Lipa na\nM-PESA', icon: <LipaIcon size={33} />, href: '/lipa' },
    { label: 'Withdraw\nMoney', icon: <WithdrawIcon size={33} /> },
    { label: 'Pochi\nWallet', icon: <PochiWalletIcon size={33} /> },
    { label: 'Buy\nBundles', icon: <BundlesIcon size={31} /> },
    { label: 'Airtime\nTop Up', icon: <AirtimeIcon size={33} /> },
    { label: 'Tunukiwa\nBundles', icon: <GiftIcon size={33} /> },
    { label: 'Home\nInternet', icon: <HomeInternetIcon size={33} /> },
  ];

  const onPageScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    if (Math.abs(dy) < 4) return;
    lastScrollY.current = y;
    const collapse = dy > 0 && y > 8;
    if (collapse !== scanCollapsed) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setScanCollapsed(collapse);
    }
  };

  const onPagerScroll =(e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / (cardWidth + s(12))));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.header, borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => router.push('/profile')} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Avatar name={account.accountName} size={50} />
          <View style={{ marginLeft: s(14) }}>
            <T variant="body" color={colors.textSecondary} style={{ fontSize: s(18) }}>{greeting()}</T>
            <T variant="body" style={{ fontSize: s(20), marginTop: s(2) }}>{firstName} 👋</T>
          </View>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: s(12) }}>
          <View>
            <CircleButton label="Messages" size={52} onPress={() => router.push('/messages')}><BellIcon size={26} /></CircleButton>
            {unread ? <View style={[styles.dot, { backgroundColor: colors.red }]} /> : null}
          </View>
          <Inert><CircleButton label="Search" size={52}><SearchIcon size={26} /></CircleButton></Inert>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: s(24) }} onScroll={onPageScroll} scrollEventThrottle={16}>
        {/* Balance cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + s(12)}
          decelerationRate="fast"
          onMomentumScrollEnd={onPagerScroll}
          onScroll={onPagerScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{ paddingHorizontal: s(16), paddingTop: s(28), gap: s(12) }}
        >
          <EdgeCard style={{ width: cardWidth }}>
            <T variant="label" color={colors.green} style={{ fontWeight: '600', fontSize: s(16) }}>M-PESA Balance</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: s(14), height: s(34) }}>
              {hidden ? (
                <View style={[styles.blurBar, { width: s(110), height: s(30), backgroundColor: colors.mode === 'dark' ? colors.raised : '#E6E8EC' }]} />
              ) : (
                <T variant="amount" style={{ fontWeight: '500', fontSize: s(24.5) }}>{formatKsh(account.currentBalanceCache)}</T>
              )}
              <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'} onPress={() => setHidden(!hidden)} hitSlop={10} style={{ marginLeft: s(22) }}>
                {hidden ? <EyeIcon size={28} /> : <EyeOffIcon size={28} />}
              </Pressable>
            </View>
            {/* Fuliza is not simulated: shown as in the reference, fixed at Ksh 0.00, and hidden with the balance (owner decisions). */}
            <View style={{ marginTop: s(12), marginBottom: s(11), height: s(20), justifyContent: 'center' }}>
              {hidden ? (
                <View style={[styles.blurBar, { width: s(205), height: s(17), backgroundColor: colors.mode === 'dark' ? colors.raised : '#E6E8EC' }]} />
              ) : (
                <T variant="label" color={colors.textSecondary} style={{ fontSize: s(16) }}>Available Fuliza: {formatKsh(0)}</T>
              )}
            </View>
            <View style={{ flex: 1 }} />
            <OutlineButton title="View Statements" onPress={() => router.push('/statements')} />
          </EdgeCard>

          <EdgeCard style={{ width: cardWidth }}>
            <T variant="label" color={colors.green} style={{ fontWeight: '600', fontSize: s(16) }}>My Balances</T>
            <View style={{ flexDirection: 'row', marginTop: s(14) }}>
              <View style={{ flex: 1 }}>
                <T variant="body" style={{ fontSize: s(18) }}>Airtime</T>
                <T variant="body" style={{ fontSize: s(20), marginTop: s(10), fontWeight: '500' }}>Ksh. {account.airtimeBalance.toLocaleString('en-US')}</T>
              </View>
              <View style={{ width: s(1), backgroundColor: colors.divider, marginHorizontal: s(16) }} />
              <Inert style={{ flex: 1 }}>
                <T variant="body" style={{ fontSize: s(18) }}>Bonga</T>
                <T variant="body" style={{ fontSize: s(20), marginTop: s(10), fontWeight: '500' }}>0 Points</T>
              </Inert>
            </View>
            {/* Pushes the button down so it lines up with View Statements on the first card. */}
            <View style={{ flex: 1, minHeight: s(14) }} />
            <Inert><OutlineButton title="View All Balances" /></Inert>
          </EdgeCard>
        </ScrollView>
        <View style={styles.dots}>
          {[0, 1].map((i) => (
            <View key={i} style={[styles.pageDot, { width: s(i === page ? 27 : 16), backgroundColor: i === page ? colors.green : colors.mode === 'dark' ? '#4A5160' : '#D5DCE2' }]} />
          ))}
        </View>

        {/* Quick actions */}
        <View style={[styles.panel, { backgroundColor: colors.surface, marginTop: s(32) }]}>
          <View style={styles.panelHeader}>
            <T variant="heading" style={{ fontSize: s(19), fontWeight: '500' }}>Quick Actions</T>
            <Inert style={{ flexDirection: 'row', alignItems: 'center', gap: s(4) }}>
              <T variant="body" color={colors.green} style={{ fontSize: s(19) }}>View all</T>
              <ChevronRightIcon size={18} color={colors.green} />
            </Inert>
          </View>
          <View style={styles.grid}>
            {quickActions.map((qa) => {
              const tile = (
                <View style={{ alignItems: 'center' }}>
                  <View style={[styles.qaCircle, { backgroundColor: colors.raised }]}>{qa.icon}</View>
                  <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.text, fontSize: s(15.5), textAlign: 'center', marginTop: s(13), lineHeight: s(20) }}>{qa.label}</Text>
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
            <T variant="heading" style={{ fontSize: s(19), fontWeight: '500' }}>Frequents</T>
            {frequentsOpen ? <ChevronUpIcon color={colors.text} /> : <ChevronDownIcon color={colors.text} />}
          </Pressable>
          {frequentsOpen ? (
            <View style={{ marginTop: s(30) }}>
              <SegmentedTabs
                compact
                value={tab}
                onChange={setTab}
                tabs={[{ key: 'apps', label: 'Apps' }, { key: 'send', label: 'Send' }, { key: 'pay', label: 'Pay' }, { key: 'bundles', label: 'Bundles' }]}
              />
              <View style={{ marginTop: s(20), minHeight: s(120) }}>
                {tab === 'apps' ? (
                  <View style={{ flexDirection: 'row', gap: s(18) }}>
                    <AppTile label={'ZiiDi Invest\n& Save'} icon={<InvestIcon size={46} />} />
                    <AppTile label="ShirikiPay" icon={<SharedPayIcon size={46} />} />
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
      {/* Collapses to the icon while scrolling down the page, expands again when scrolling back up (reference 01-home/04). */}
      <Inert style={[styles.scanPill, scanCollapsed && styles.scanPillCollapsed, { backgroundColor: colors.mode === 'dark' ? colors.raised : colors.screen, shadowColor: '#000' }]}>
        <ScanIcon size={30} />
        {scanCollapsed ? null : <T variant="body" style={{ fontSize: s(19), marginLeft: s(14) }}>Scan to pay</T>}
      </Inert>
    </SafeAreaView>
  );
}

function AppTile({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <Inert style={{ alignItems: 'center', width: s(110) }}>
      {icon}
      <T variant="label" center style={{ marginTop: s(8) }}>{label}</T>
    </Inert>
  );
}

const TYPE_LABEL: Partial<Record<SimulationType, string>> = {
  SEND_MONEY: 'Send Money', POCHI: 'Pochi la Biashara', PAYBILL: 'Paybill', BUY_GOODS: 'Buy Goods',
};

/** Opens the matching journey with the counterparty pre-filled. */
function openFrequent(f: FavouriteSuggestion) {
  const c = f.counterparty;
  const params: Record<string, string> = { tab: f.type };
  if (c.phone) params.phone = toLocalPhone(c.phone);
  for (const k of ['name', 'tillNumber', 'paybillNumber', 'businessName', 'accountReference', 'accountName'] as const) {
    const v = c[k];
    if (v) params[k] = v;
  }
  router.push({ pathname: f.type === 'SEND_MONEY' || f.type === 'POCHI' ? '/send-money' : '/lipa', params });
}

function FrequentList({ items }: { items: FavouriteSuggestion[] }) {
  const { colors } = useTheme();
  if (items.length === 0) return <EmptyFrequents />;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: s(6) }}>
      {items.map((f) => (
        <Pressable key={`${f.type}|${f.key}`} accessibilityRole="button" accessibilityLabel={f.label} onPress={() => openFrequent(f)} style={{ alignItems: 'center', width: s(112) }}>
          <Avatar name={f.label} size={52} fontSize={17} />
          <T variant="body" center numberOfLines={2} style={{ marginTop: s(10), fontSize: s(17), fontWeight: '500' }}>{f.label}</T>
          <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(4) }}>{TYPE_LABEL[f.type] ?? ''}</T>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function EmptyFrequents({ action }: { action?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: s(130), alignItems: 'center' }}>
        <EmptyActivityArt width={120} />
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <T variant="label" style={{ textAlign: 'right', lineHeight: s(22) }}>It looks like you&apos;re starting fresh here.</T>
        {action ? <Inert><T variant="label" color={colors.green} style={{ marginTop: s(14) }}>{action}</T></Inert> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: s(16), paddingTop: s(14), paddingBottom: s(30), borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { position: 'absolute', top: s(2), right: s(2), width: s(12), height: s(12), borderRadius: s(6) },
  blurBar: { height: s(30), borderRadius: s(8), opacity: 0.9 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: s(8), marginTop: s(18) },
  pageDot: { height: s(5), borderRadius: s(3) },
  panel: { marginHorizontal: s(16), marginTop: s(22), borderRadius: s(18), paddingHorizontal: s(20), paddingTop: s(24), paddingBottom: s(20) },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: s(30), marginBottom: s(-14) },
  gridCell: { width: '25%', alignItems: 'center', marginBottom: s(11) },
  qaCircle: { width: s(52), height: s(52), borderRadius: s(26), alignItems: 'center', justifyContent: 'center' },
  scanPill: {
    position: 'absolute', right: s(16), bottom: s(24), flexDirection: 'row', alignItems: 'center', paddingHorizontal: s(24), paddingVertical: s(16),
    borderRadius: s(16), elevation: 6, shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: s(4) },
  },
  scanPillCollapsed: { paddingHorizontal: s(20), paddingVertical: s(20) },
});
