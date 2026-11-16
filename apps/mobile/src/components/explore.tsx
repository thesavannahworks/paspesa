/**
 * Home: "Explore & Discover Deals" carousel and "My Finances" (reference-screenshots/01-home/12-17).
 *
 * The reference banners are third-party adverts (Safaricom, LETA, PATA MORE) and are kept only as
 * references (White Paper §40). These banners are Paspesa's own and point to Paspesa journeys.
 * The carousel advances every 10 seconds and loops forever (owner request).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import {
  BriefcaseIcon, ChevronRightIcon, GoIcon, GrowthIcon, InvestIcon, SavingsIcon, ScheduleIcon, SharedPayIcon, ShieldLeafIcon,
  TraderIcon, UmbrellaIcon, WalletIcon,
} from '@/icons';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';
import { Inert, T } from './ui';

export const AUTO_ADVANCE_MS = 10_000;

// ---------------------------------------------------------------- banners

interface Banner {
  key: string;
  href: Href;
  render: () => ReactNode;
}

function BannerText({ tag, title, body, cta, dark, ctaColor }: { tag: string; title: string; body: string; cta: string; dark: boolean; ctaColor: string }) {
  const fg = dark ? '#FFFFFF' : '#1D2433';
  return (
    <View style={{ flex: 1.25, paddingLeft: s(18), paddingVertical: s(16), justifyContent: 'space-between' }}>
      <View>
        <Text maxFontSizeMultiplier={FIXED_TEXT} style={[bs.tag, { color: dark ? '#C9F7CF' : '#2E7D32' }]}>{tag}</Text>
        <Text maxFontSizeMultiplier={FIXED_TEXT} style={[bs.title, { color: fg }]}>{title}</Text>
        <Text maxFontSizeMultiplier={FIXED_TEXT} style={[bs.body, { color: dark ? 'rgba(255,255,255,0.85)' : '#4B5563' }]}>{body}</Text>
      </View>
      <View style={[bs.cta, { backgroundColor: ctaColor }]}>
        <Text maxFontSizeMultiplier={FIXED_TEXT} style={bs.ctaText}>{cta}  →</Text>
      </View>
    </View>
  );
}

const BANNERS: Banner[] = [
  {
    key: 'practise',
    href: '/send-money',
    render: () => (
      <LinearGradient colors={['#14612A', '#36A839']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={bs.banner}>
        <BannerText dark tag="PASPESA" title="Practise payments safely" body="Send, pay and top up with simulated money." cta="Try Send Money" ctaColor="#E92536" />
        <View style={bs.art}>
          <Svg width={s(150)} height={s(170)} viewBox="0 0 150 170" fill="none">
            <Circle cx={92} cy={86} r={70} fill="#FFFFFF" opacity={0.12} />
            <Rect x={46} y={20} width={78} height={136} rx={14} fill="#FFFFFF" />
            <Rect x={54} y={34} width={62} height={98} rx={6} fill="#E8F5E9" />
            <Circle cx={85} cy={72} r={20} fill="#36A839" />
            <Path d="m76 72 6 6 12-13" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
            <Rect x={64} y={102} width={42} height={7} rx={3.5} fill="#36A839" opacity={0.5} />
            <Rect x={70} y={115} width={30} height={6} rx={3} fill="#36A839" opacity={0.3} />
            <Circle cx={30} cy={44} r={9} fill="#E92536" />
            <Circle cx={134} cy={136} r={6} fill="#FFFFFF" opacity={0.7} />
          </Svg>
        </View>
      </LinearGradient>
    ),
  },
  {
    key: 'tariff',
    href: '/lipa',
    render: () => (
      <View style={[bs.banner, { backgroundColor: '#1B2140' }]}>
        <BannerText dark tag="KNOW THE COST" title="See the charges before you pay" body="Every confirm screen shows the M-PESA tariff." cta="Lipa na M-PESA" ctaColor="#E92536" />
        <View style={[bs.art, { backgroundColor: '#DCE8F7', borderTopLeftRadius: s(0) }]}>
          <Svg width={s(170)} height={s(170)} viewBox="0 0 170 170" fill="none">
            <Rect x={30} y={22} width={110} height={130} rx={10} fill="#FFFFFF" />
            <Path d="M30 140v12l10-6 10 6 10-6 10 6 10-6 10 6 10-6 10 6 10-6 10 6v-12" fill="#FFFFFF" />
            <Rect x={44} y={40} width={60} height={8} rx={4} fill="#1B2140" opacity={0.8} />
            <Rect x={44} y={62} width={40} height={6} rx={3} fill="#9AA5B8" />
            <Rect x={98} y={60} width={28} height={10} rx={5} fill="#36A839" />
            <Rect x={44} y={84} width={46} height={6} rx={3} fill="#9AA5B8" />
            <Rect x={98} y={82} width={28} height={10} rx={5} fill="#E92536" />
            <Rect x={44} y={112} width={82} height={2} fill="#D5DCE2" />
            <Rect x={44} y={122} width={34} height={8} rx={4} fill="#1B2140" />
            <Rect x={96} y={122} width={30} height={8} rx={4} fill="#1B2140" />
          </Svg>
        </View>
      </View>
    ),
  },
  {
    key: 'statements',
    href: '/statements',
    render: () => (
      <LinearGradient colors={['#FFF6E8', '#FDE7EC']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={bs.banner}>
        <BannerText dark={false} tag="ALWAYS IN SYNC" title="One ledger, every record" body="Messages, history and statements match every simulation." cta="View Statements" ctaColor="#36A839" />
        <View style={bs.art}>
          <Svg width={s(160)} height={s(170)} viewBox="0 0 160 170" fill="none">
            <Circle cx={88} cy={88} r={66} fill="#36A839" opacity={0.12} />
            <Rect x={34} y={26} width={104} height={124} rx={12} fill="#FFFFFF" />
            {[0, 1, 2, 3].map((i) => (
              <Path key={i} d={`M48 ${50 + i * 24}h46`} stroke="#1D2433" strokeWidth={6} strokeLinecap="round" opacity={0.75 - i * 0.12} />
            ))}
            {[0, 1, 2, 3].map((i) => (
              <Rect key={`a${i}`} x={104} y={46 + i * 24} width={22} height={9} rx={4.5} fill={i % 2 ? '#E92536' : '#36A839'} />
            ))}
            <Circle cx={138} cy={36} r={16} fill="#36A839" />
            <Path d="m131 36 5 5 9-10" stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </LinearGradient>
    ),
  },
];

/** Auto-advancing, endlessly looping banner carousel. */
export function ExploreCarousel() {
  const [width, setWidth] = useState(0);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const index = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // A copy of the first banner at the end makes "last → first" look like a forward move.
  const slides = [...BANNERS, BANNERS[0]!];

  const jumpHomeIfOnCopy = useCallback(() => {
    if (index.current === BANNERS.length) {
      index.current = 0;
      scroller.current?.scrollTo({ x: 0, animated: false });
    }
  }, []);

  const start = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (!width) return;
    timer.current = setInterval(() => {
      index.current += 1;
      scroller.current?.scrollTo({ x: index.current * width, animated: true });
      setTimeout(jumpHomeIfOnCopy, 600);
    }, AUTO_ADVANCE_MS);
  }, [width, jumpHomeIfOnCopy]);

  useEffect(() => {
    start();
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [start]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    index.current = Math.round(e.nativeEvent.contentOffset.x / width);
    jumpHomeIfOnCopy();
    start(); // a manual swipe restarts the 10-second wait
  };

  return (
    <View style={bs.frame} onLayout={onLayout}>
      {width ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onSettled}
          scrollEventThrottle={16}
        >
          {slides.map((b, i) => (
            <Pressable key={`${b.key}-${i}`} accessibilityRole="link" accessibilityLabel={b.key} onPress={() => router.push(b.href)} style={{ width, height: '100%' }}>
              {b.render()}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- My Finances

interface FinanceItem {
  label: string;
  icon: ReactNode;
  tile: { dark: string; light: string };
}

const g = { dark: '#1F3324', light: '#E6F4E8' };
const FINANCES: FinanceItem[] = [
  { label: 'ZiiDi\nTrader', icon: <TraderIcon size={34} />, tile: g },
  { label: 'ZiiDi\nInvest & Save', icon: <InvestIcon size={46} />, tile: g },
  { label: 'Ziidi\nShariah', icon: <Disc color="#36A839"><ShieldLeafIcon size={26} color="#FFFFFF" accent="#FFFFFF" /></Disc>, tile: g },
  { label: 'Tuunza\nMapato', icon: <Disc color="#36A839"><SavingsIcon size={26} color="#FFFFFF" accent="#FFFFFF" /></Disc>, tile: g },
  { label: 'ShirikiPay', icon: <SharedPayIcon size={46} />, tile: { dark: '#3A1F22', light: '#FBE7E9' } },
  { label: 'Mali', icon: <Disc color="#36A839"><GrowthIcon size={26} color="#FFFFFF" accent="#FFFFFF" /></Disc>, tile: g },
  { label: 'Faraja', icon: <Disc color="#F07A2B"><UmbrellaIcon size={26} color="#FFFFFF" accent="#FFFFFF" /></Disc>, tile: { dark: '#3A2A1E', light: '#FDEEE3' } },
  { label: 'M-PESA\nRatiba', icon: <Disc color="#36A839"><ScheduleIcon size={26} color="#FFFFFF" accent="#FFFFFF" /></Disc>, tile: g },
  { label: 'MPESA\nGO', icon: <GoIcon size={36} />, tile: { dark: '#3A3424', light: '#F7F1DE' } },
  { label: 'Ziidi\nPochi', icon: <Disc color="#36A839"><WalletIcon size={26} color="#FFFFFF" accent="#FFFFFF" /></Disc>, tile: g },
  { label: 'Pochi la\nBiashara', icon: <Disc color="#7B61FF"><BriefcaseIcon size={26} color="#FFFFFF" accent="#FFFFFF" /></Disc>, tile: { dark: '#2E2440', light: '#EEE9FF' } },
];

function Disc({ color, children }: { color: string; children: ReactNode }) {
  return <View style={{ width: s(46), height: s(46), borderRadius: s(23), backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

/** My Finances panel. Tiles are inert: these products are not simulated (owner rule for undiscussed items). */
export function MyFinances() {
  const { colors } = useTheme();
  return (
    <View style={[fs.panel, { backgroundColor: colors.surface }]}>
      <View style={fs.header}>
        <T variant="heading" style={{ fontSize: s(19), fontWeight: '500' }}>My Finances</T>
        <Inert style={{ flexDirection: 'row', alignItems: 'center', gap: s(4) }}>
          <T variant="body" color={colors.green} style={{ fontSize: s(19) }}>View all</T>
          <ChevronRightIcon size={18} color={colors.green} />
        </Inert>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: s(2), marginTop: s(24) }}>
        {FINANCES.map((f) => (
          <Inert key={f.label} style={fs.cell}>
            <View style={[fs.tile, { backgroundColor: colors.mode === 'dark' ? f.tile.dark : f.tile.light }]}>{f.icon}</View>
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={[fs.label, { color: colors.text }]}>{f.label}</Text>
          </Inert>
        ))}
      </ScrollView>
    </View>
  );
}

const bs = StyleSheet.create({
  frame: { marginHorizontal: s(21), marginTop: s(15), height: s(206), borderRadius: s(12), overflow: 'hidden' },
  banner: { flex: 1, flexDirection: 'row', overflow: 'hidden' },
  art: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tag: { fontSize: s(12), fontWeight: '700', letterSpacing: s(1.2) },
  title: { fontSize: s(21), fontWeight: '800', marginTop: s(6), lineHeight: s(25) },
  body: { fontSize: s(13.5), marginTop: s(6), lineHeight: s(18) },
  cta: { alignSelf: 'flex-start', borderRadius: s(18), paddingHorizontal: s(14), paddingVertical: s(7) },
  ctaText: { color: '#FFFFFF', fontSize: s(13.5), fontWeight: '700' },
});

const fs = StyleSheet.create({
  panel: { marginHorizontal: s(21), marginTop: s(16), borderRadius: s(18), paddingHorizontal: s(20), paddingTop: s(24), paddingBottom: s(20) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cell: { width: s(105), alignItems: 'center' },
  tile: { width: s(64), height: s(64), borderRadius: s(12), alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: s(15.5), lineHeight: s(21), textAlign: 'center', marginTop: s(12) },
});
