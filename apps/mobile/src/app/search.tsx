/**
 * Home search (magnifier on the home header): finds services and transactions.
 * Services that Paspesa simulates open their journey; the rest are listed but inert.
 * Transactions are matched with the same rules as the M-PESA statement search.
 */
import { buildStatement, formatStatementAmount } from '@paspesa/core';
import { router, type Href } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, CircleButton, Inert, T, WEB_NO_OUTLINE, goBack } from '@/components/ui';
import {
  AirtimeIcon, BellIcon, BundlesIcon, ChevronLeftIcon, ChevronRightIcon, GiftIcon, HomeInternetIcon, LipaIcon, PochiWalletIcon,
  ReceiptIcon, ScanIcon, SearchIcon, SendMoneyIcon, WithdrawIcon,
} from '@/icons';
import { useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

interface Service {
  label: string;
  keywords: string;
  icon: ReactNode;
  href?: Href;
}

const SERVICES: Service[] = [
  { label: 'Send Money', keywords: 'send money transfer mobile number', icon: <SendMoneyIcon size={26} />, href: '/send-money' },
  { label: 'Lipa na M-PESA', keywords: 'lipa pay buy goods till paybill business pochi', icon: <LipaIcon size={26} />, href: '/lipa' },
  { label: 'Airtime Top Up', keywords: 'airtime top up credit', icon: <AirtimeIcon size={26} />, href: '/airtime' },
  { label: 'Scan to Pay', keywords: 'scan qr code pay my qr', icon: <ScanIcon size={26} />, href: '/scan' },
  { label: 'M-PESA Statements', keywords: 'statements history transactions', icon: <ReceiptIcon size={26} />, href: '/statements' },
  { label: 'Messages', keywords: 'messages sms notifications confirmations', icon: <BellIcon size={26} />, href: '/messages' },
  { label: 'Withdraw Money', keywords: 'withdraw cash agent', icon: <WithdrawIcon size={26} /> },
  { label: 'Pochi Wallet', keywords: 'pochi wallet', icon: <PochiWalletIcon size={26} /> },
  { label: 'Buy Bundles', keywords: 'bundles data internet', icon: <BundlesIcon size={24} /> },
  { label: 'Tunukiwa Bundles', keywords: 'tunukiwa bundles offers', icon: <GiftIcon size={26} /> },
  { label: 'Home Internet', keywords: 'home internet fibre', icon: <HomeInternetIcon size={26} /> },
];

export default function SearchScreen() {
  const { colors } = useTheme();
  const { transactions, deps } = useAppState();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const services = useMemo(
    () => (q ? SERVICES.filter((x) => q.split(/\s+/).every((t) => `${x.label} ${x.keywords}`.toLowerCase().includes(t))) : SERVICES),
    [q],
  );
  const rows = useMemo(
    () => (q ? buildStatement(transactions, { utcOffsetMinutes: deps.config.utcOffsetMinutes, search: q }).groups.flatMap((g) => g.rows).slice(0, 30) : []),
    [transactions, deps.config.utcOffsetMinutes, q],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.screen }} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <CircleButton label="Back" onPress={goBack}><ChevronLeftIcon color={colors.text} size={26} /></CircleButton>
        <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <SearchIcon size={24} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search services and transactions"
            placeholderTextColor={colors.textMuted}
            maxFontSizeMultiplier={FIXED_TEXT}
            returnKeyType="search"
            accessibilityLabel="Search"
            style={[{ flex: 1, color: colors.text, fontSize: s(17), marginLeft: s(10), paddingVertical: 0 }, WEB_NO_OUTLINE]}
          />
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: s(21), paddingBottom: s(30) }}>
        {services.length ? <T variant="label" color={colors.textSecondary} style={styles.section}>Services</T> : null}
        {services.map((x) => {
          const content = (
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: colors.raised }]}>{x.icon}</View>
              <T variant="body" style={{ flex: 1, marginLeft: s(14), fontSize: s(17) }}>{x.label}</T>
              {x.href ? <ChevronRightIcon size={20} color={colors.textSecondary} /> : null}
            </View>
          );
          return x.href ? (
            <Pressable key={x.label} accessibilityRole="button" accessibilityLabel={x.label} onPress={() => router.replace(x.href!)}>{content}</Pressable>
          ) : (
            <Inert key={x.label}>{content}</Inert>
          );
        })}

        {q ? <T variant="label" color={colors.textSecondary} style={styles.section}>Transactions</T> : null}
        {q && rows.length === 0 ? <T variant="body" color={colors.textSecondary}>No matching transactions.</T> : null}
        {rows.map((r) => (
          <Pressable
            key={r.transactionId}
            accessibilityRole="button"
            accessibilityLabel={`${r.title} ${r.reference}`}
            onPress={() => router.push({ pathname: '/statements/[id]', params: { id: r.transactionId } })}
            style={styles.row}
          >
            <Avatar name={r.title || 'Paspesa'} size={46} />
            <View style={{ flex: 1, marginLeft: s(14) }}>
              <T variant="body" style={{ fontSize: s(17) }} numberOfLines={1}>{r.title}</T>
              <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(3) }}>{r.reference}</T>
            </View>
            <T variant="body" style={{ fontSize: s(16) }}>{formatStatementAmount(r.signedAmount)}</T>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: s(12), paddingHorizontal: s(21), paddingTop: s(14), paddingBottom: s(8) },
  box: { flex: 1, flexDirection: 'row', alignItems: 'center', height: s(52), borderRadius: s(12), borderWidth: 1, paddingHorizontal: s(14) },
  section: { marginTop: s(22), marginBottom: s(6) },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(10) },
  icon: { width: s(46), height: s(46), borderRadius: s(23), alignItems: 'center', justifyContent: 'center' },
});
