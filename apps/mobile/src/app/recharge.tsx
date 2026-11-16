import {
  formatConfirmTransactionCost,
  formatKsh,
  parseWholeShillings,
  processSimulation,
  quoteSimulation,
  toLocalPhone,
  type SimulationRequest,
  type TransactionRecord,
} from '@paspesa/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ConfirmView, PinView, SuccessView } from '@/components/journey';
import { Avatar, Field, PrimaryButton, Screen, ScreenHeader, T } from '@/components/ui';
import { useAccount, useAppState } from '@/services/AppState';
import { useSubmission } from '@/services/useSubmission';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

type Step = 'form' | 'confirm' | 'pin' | 'success';

/**
 * General Operations → Recharge (White Paper §10.2, AGREED).
 * Adds the amount to the previous balance as an incoming transaction from the chosen sender.
 */
export default function RechargeScreen() {
  const { colors } = useTheme();
  const { deps, refresh } = useAppState();
  const account = useAccount();
  const submission = useSubmission();
  const defaults = account.rechargeSenderDefaults ?? deps.config.defaultRechargeSender;

  const [step, setStep] = useState<Step>('form');
  const [amount, setAmount] = useState('');
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pinError, setPinError] = useState<string | null>(null);
  const [result, setResult] = useState<TransactionRecord | null>(null);

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setErrors({});
    submission.reset();
  };

  const request = (): Omit<SimulationRequest, 'operationId'> | null => {
    const value = parseWholeShillings(amount);
    if (value === null) return null;
    return { type: 'RECHARGE', amount: value, counterparty: custom ? { name, phone } : {} };
  };

  const quote = (() => {
    const r = request();
    return r ? quoteSimulation(account, deps.config, r) : null;
  })();

  const onContinue = () => {
    if (!quote) {
      setErrors({ amount: 'Enter an amount in whole shillings' });
      return;
    }
    if (!quote.ok) {
      setErrors(quote.error.fieldErrors ?? { amount: quote.error.message });
      return;
    }
    setStep('confirm');
  };

  const onPin = async (pin: string) => {
    const r = request();
    if (!r) return;
    const res = await submission.run((operationId) => processSimulation(deps, { ...r, operationId, pin }));
    if (!res.ok) {
      setPinError(res.error.message);
      return;
    }
    setPinError(null);
    await refresh();
    setResult(res.transaction);
    setStep('success');
  };

  const sender = quote?.ok ? quote.quote.counterparty : { name: defaults.name, phone: defaults.phone };

  if (step === 'success' && result) {
    return (
      <SuccessView
        transaction={result}
        partyLabel="Received from:"
        partyBadge={<Avatar name={result.counterparty.name ?? 'Paspesa'} size={56} />}
        partyLines={[(result.counterparty.name ?? '').toUpperCase(), `Phone number:${toLocalPhone(result.counterparty.phone ?? '')}`]}
        onDone={() => router.dismissTo('/')}
      />
    );
  }

  if (step === 'pin' && quote?.ok) {
    return (
      <PinView
        badge={<Avatar name={sender.name ?? 'Paspesa'} size={79} fontSize={16.5} fontWeight="400" />}
        name={sender.name ?? ''}
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
    return (
      <ConfirmView
        badge={<Avatar name={sender.name ?? 'Paspesa'} size={64} fontSize={24} />}
        title="Recharge account"
        rows={[
          { label: 'Amount', value: formatKsh(quote.quote.amount) },
          { label: 'From', value: sender.name ?? '' },
          { label: 'Phone number', value: toLocalPhone(sender.phone ?? '') },
          { label: 'Transaction cost', value: formatConfirmTransactionCost(quote.quote.fee) },
        ]}
        actionLabel="Recharge"
        onConfirm={() => setStep('pin')}
        onBack={() => setStep('form')}
      />
    );
  }

  return (
    <Screen footer={<PrimaryButton title="Continue" onPress={onContinue} disabled={amount.trim() === ''} />}>
      <ScreenHeader title="Recharge Account" />
      <Field
        label="Enter Amount"
        value={amount}
        onChangeText={edit(setAmount)}
        placeholder="0"
        keyboardType="number-pad"
        right={<T variant="body">Ksh</T>}
        error={errors.amount}
        hint={`Balance: ${formatKsh(account.currentBalanceCache)}`}
      />

      <T variant="label" style={{ marginTop: s(26), fontWeight: '700' }}>Sender</T>
      <View style={{ flexDirection: 'row', gap: s(12), marginTop: s(12) }}>
        <SenderOption selected={!custom} title={defaults.name} subtitle={toLocalPhone(defaults.phone)} caption="Default" onPress={() => { setCustom(false); submission.reset(); }} />
        <SenderOption selected={custom} title="Custom sender" subtitle="Enter name and number" onPress={() => { setCustom(true); submission.reset(); }} />
      </View>

      {custom ? (
        <>
          <Field label="Sender name" value={name} onChangeText={edit(setName)} placeholder={defaults.name} autoCapitalize="words" error={errors.name} />
          <Field label="Sender phone number" value={phone} onChangeText={edit(setPhone)} placeholder="07XX XXX XXX" keyboardType="phone-pad" error={errors.phone} hint="Leave blank to use the default number" />
        </>
      ) : null}

      <T variant="caption" color={colors.textMuted} style={{ marginTop: s(22), lineHeight: s(18) }}>
        The amount is added to your current simulated balance and recorded as an incoming transaction. This is not real money.
      </T>
    </Screen>
  );
}

function SenderOption({ selected, title, subtitle, caption, onPress }: { selected: boolean; title: string; subtitle: string; caption?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.option, { borderColor: selected ? colors.green : colors.inputBorder, backgroundColor: selected ? colors.paymentCardSelected : colors.paymentCard }]}
    >
      {selected ? <View style={[styles.corner, { borderTopColor: colors.green }]} /> : null}
      <T variant="bodyStrong" numberOfLines={1}>{title}</T>
      <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(4) }}>{subtitle}</T>
      {caption ? <T variant="caption" color={colors.green} style={{ marginTop: s(4) }}>{caption}</T> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: { flex: 1, borderWidth: 1.4, borderRadius: s(10), padding: s(14), minHeight: s(92), overflow: 'hidden' },
  corner: {
    position: 'absolute', top: 0, right: 0, width: 0, height: 0,
    borderTopWidth: 26, borderLeftWidth: 26, borderLeftColor: 'transparent',
  },
});
