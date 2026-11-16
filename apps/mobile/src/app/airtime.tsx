/**
 * Airtime Top Up (reference-screenshots/07-airtime): M-PESA tab (Scratch Card inert), own or other
 * number, quick amounts, Confirm → PIN → result. Own-number airtime is capped by config
 * (maxAirtimeBalance, AGREED Ksh 1,000) and fee is Ksh 0 (AGREED).
 */
import {
  favouritesFor,
  formatAmount,
  formatConfirmTransactionCost,
  formatKsh,
  parseWholeShillings,
  processSimulation,
  quoteSimulation,
  toLocalPhone,
  type FavouriteSuggestion,
  type SimulationRequest,
  type TransactionRecord,
} from '@paspesa/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConfirmView, PinView } from '@/components/journey';
import { AddFavouriteSheet, FavouritesStrip } from '@/components/payments';
import { BadgeCard, CircleButton, Field, Inert, PrimaryButton, Screen, ScreenHeader, SegmentedTabs, T } from '@/components/ui';
import { AirtimeIcon, ChevronRightIcon, CloseIcon, ContactIcon, GlobalAirtimeIcon } from '@/icons';
import { useAccount, useAppState } from '@/services/AppState';
import { useSubmission } from '@/services/useSubmission';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

type Target = 'OWN' | 'OTHER';
const QUICK_AMOUNTS = [50, 100, 200, 500, 1000];

export default function AirtimeScreen() {
  const { colors } = useTheme();
  const { deps, refresh, transactions, favourites } = useAppState();
  const account = useAccount();
  const submission = useSubmission();

  const [target, setTarget] = useState<Target>('OWN');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'form' | 'confirm' | 'pin' | 'success'>('form');
  const [pinError, setPinError] = useState<string | null>(null);
  const [result, setResult] = useState<TransactionRecord | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const favs = useMemo(
    () => favouritesFor(['AIRTIME'], favourites, transactions, deps.config.frequentThreshold),
    [favourites, transactions, deps.config.frequentThreshold],
  );

  const changed = () => { setErrors({}); submission.reset(); };
  const request = (): Omit<SimulationRequest, 'operationId'> | null => {
    const value = parseWholeShillings(amount);
    if (value === null) return null;
    return { type: 'AIRTIME', variant: target, amount: value, counterparty: target === 'OTHER' ? { phone } : {} };
  };
  const req = request();
  const quote = req ? quoteSimulation(account, deps.config, req) : null;

  const onTopUp = () => {
    if (!quote) return setErrors({ amount: 'Enter an amount in whole shillings' });
    if (!quote.ok) return setErrors(quote.error.fieldErrors ?? { amount: quote.error.message });
    setStep('confirm');
  };

  const onPin = async (pin: string) => {
    if (!req) return;
    const res = await submission.run((operationId) => processSimulation(deps, { ...req, operationId, pin }));
    if (!res.ok) return setPinError(res.error.message);
    setPinError(null);
    await refresh();
    setResult(res.transaction);
    setStep('success');
  };

  const badge = (size: number) => (
    <View style={{ width: s(size), height: s(size), borderRadius: s(size / 2), backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
      <AirtimeIcon size={size * 0.46} />
    </View>
  );

  if (step === 'success' && result) return <AirtimeSuccess tx={result} />;

  if (step === 'pin' && quote?.ok) {
    return (
      <PinView
        badge={badge(76)}
        name="Buy Airtime"
        keepCase
        amount={quote.quote.amount}
        fee={quote.quote.fee}
        onSubmit={onPin}
        onBack={() => { setPinError(null); setStep('confirm'); }}
        error={pinError}
        busy={submission.busy}
      />
    );
  }

  if (step === 'confirm' && quote?.ok) {
    const q = quote.quote;
    return (
      <ConfirmView
        badge={badge(64)}
        title="Airtime Top Up"
        rows={target === 'OWN'
          ? [{ label: 'Amount', value: formatKsh(q.amount) }, { label: 'Transaction cost', value: formatConfirmTransactionCost(q.fee) }]
          : [{ label: 'Original Amount', value: formatAmount(q.amount) }, { label: 'Phone number', value: toLocalPhone(q.counterparty.phone ?? '') }]}
        actionLabel="Confirm"
        onConfirm={() => setStep('pin')}
        onBack={() => setStep('form')}
      />
    );
  }

  const pickFavourite = (f: FavouriteSuggestion) => { setPhone(toLocalPhone(f.counterparty.phone ?? '')); changed(); };
  const canTopUp = amount.trim() !== '' && (target === 'OWN' || phone.trim() !== '');

  return (
    <Screen>
      <ScreenHeader title="Airtime Top Up" />
      <View style={{ marginTop: s(30) }}>
        <SegmentedTabs value="MPESA" onChange={() => undefined} tabs={[{ key: 'MPESA', label: 'M-PESA' }, { key: 'SCRATCH', label: 'Scratch Card', inert: true }]} />
      </View>

      <T variant="label" style={{ marginTop: s(30), fontSize: s(16) }}>Top Up For</T>
      <View style={{ flexDirection: 'row', marginTop: s(20) }}>
        <Radio label="Own Number" checked={target === 'OWN'} onPress={() => { setTarget('OWN'); changed(); }} />
        <Radio label="Other Number" checked={target === 'OTHER'} onPress={() => { setTarget('OTHER'); changed(); }} />
      </View>

      {target === 'OTHER' ? <FavouritesStrip items={favs} onPick={pickFavourite} onAdd={() => setAddOpen(true)} /> : null}

      <Field
        label="Phone Number"
        placeholder="Enter Phone Number"
        value={target === 'OWN' ? toLocalPhone(account.phoneNumber) : phone}
        editable={target === 'OTHER'}
        onChangeText={(v) => { setPhone(v); changed(); }}
        keyboardType="phone-pad"
        error={errors.phone}
        right={target === 'OTHER' ? <Inert><ContactIcon size={24} /></Inert> : undefined}
      />
      <Field
        label="Enter amount"
        placeholder="0.00"
        value={amount}
        onChangeText={(v) => { setAmount(v); changed(); }}
        keyboardType="number-pad"
        error={errors.amount}
        hint="Minimum top up amount Ksh. 1"
        right={<T variant="body">Ksh</T>}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: s(14), marginTop: s(14) }} keyboardShouldPersistTaps="handled">
        {QUICK_AMOUNTS.map((a) => (
          <Pressable key={a} accessibilityRole="button" accessibilityLabel={`ksh ${a}`} onPress={() => { setAmount(String(a)); changed(); }}
            style={[styles.chip, { backgroundColor: colors.raised }]}>
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.text, fontSize: s(16) }}>ksh {a}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <PrimaryButton title="Top Up" onPress={onTopUp} disabled={!canTopUp} style={{ marginTop: s(24) }} />

      <T variant="bodyStrong" style={{ marginTop: s(36), fontSize: s(17) }}>Do More</T>
      <Inert style={[styles.doMore, { backgroundColor: colors.surface }]}>
        <View style={[styles.doMoreIcon, { backgroundColor: colors.raised }]}><GlobalAirtimeIcon size={30} /></View>
        <View style={{ flex: 1, marginLeft: s(16) }}>
          <T variant="body" style={{ fontSize: s(17) }}>Buy Global Airtime</T>
          <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(4) }}>Buy airtime from different countries</T>
        </View>
        <ChevronRightIcon size={22} color={colors.text} />
      </Inert>

      <AddFavouriteSheet type="AIRTIME" visible={addOpen} onClose={() => setAddOpen(false)} />
    </Screen>
  );
}

function Radio({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={label} onPress={onPress} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: s(14) }}>
      <View style={[styles.radio, { borderColor: checked ? colors.green : colors.textSecondary }]}>
        {checked ? <View style={[styles.radioDot, { backgroundColor: colors.green }]} /> : null}
      </View>
      <T variant="body" style={{ marginLeft: s(14), fontSize: s(16) }}>{label}</T>
    </Pressable>
  );
}

/** Airtime result (reference 07-airtime/05, 09): no transaction ID or actions, just the confirmation. */
function AirtimeSuccess({ tx }: { tx: TransactionRecord }) {
  const { colors } = useTheme();
  const other = tx.variant === 'OTHER';
  return (
    <Screen footer={<PrimaryButton title="Done" onPress={() => router.dismissTo('/')} />}>
      <View style={{ paddingTop: s(24) }}>
        <CircleButton label="Close" onPress={() => router.dismissTo('/')} size={48}><CloseIcon size={28} /></CircleButton>
      </View>
      <BadgeCard badge={<Text maxFontSizeMultiplier={FIXED_TEXT} style={{ fontSize: s(44) }}>🎉</Text>} badgeSize={92} style={{ marginTop: s(90) }}>
        <View style={{ paddingHorizontal: s(24), paddingBottom: s(30), alignItems: 'center' }}>
          <T variant="title" center style={{ fontSize: s(25), fontWeight: '400' }}>Your transaction is successful</T>
          <T variant="body" center style={{ marginTop: s(14), fontSize: s(16), lineHeight: s(23) }}>
            You have successfully purchased airtime worth <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ fontWeight: '700', color: colors.text }}>{formatKsh(tx.amount)}</Text>
            {other ? <> for <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ fontWeight: '700', color: colors.text }}>{tx.counterparty.phone}</Text></> : null}.
          </T>
        </View>
      </BadgeCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: s(8), paddingHorizontal: s(20), paddingVertical: s(11) },
  radio: { width: s(26), height: s(26), borderRadius: s(13), borderWidth: 1.8, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: s(15), height: s(15), borderRadius: s(8) },
  doMore: { flexDirection: 'row', alignItems: 'center', borderRadius: s(12), padding: s(18), marginTop: s(16), marginBottom: s(12) },
  doMoreIcon: { width: s(50), height: s(50), borderRadius: s(25), alignItems: 'center', justifyContent: 'center' },
});
