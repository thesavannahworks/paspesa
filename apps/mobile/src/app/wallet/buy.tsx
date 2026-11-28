/**
 * Buy tokens (White Paper §31; owner decision: pay KSh N, get N tokens). An M-PESA STK prompt is sent to the
 * chosen number; tokens are added only after the server has verified the payment.
 */
import { normalizeKenyanPhone, parseWholeShillings, toLocalPhone } from '@paspesa/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Field, OutlineButton, PrimaryButton, Screen, ScreenHeader, T, goBack } from '@/components/ui';
import { ApiError, useApi } from '@/services/api';
import { useAccount } from '@/services/AppState';
import { useRemote, type PaymentView } from '@/services/wallet';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

const AMOUNTS = [50, 100, 200, 500, 1000];
const POLL_MS = 4_000;
/** About 3 minutes of waiting on this screen; the server keeps checking after that. */
const POLL_TRIES = 45;

export default function BuyTokensScreen() {
  const { colors } = useTheme();
  const api = useApi();
  const account = useAccount();
  const providers = useRemote<{ providers: string[]; default: string | null }>('/v1/payments/providers');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState(toLocalPhone(account.phoneNumber));
  const [provider, setProvider] = useState<string | null>(null);
  const [phase, setPhase] = useState<'form' | 'waiting' | 'stalled' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const key = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const shillings = parseWholeShillings(amount);
  const chosen = provider ?? providers.data?.default ?? null;

  const poll = (id: string, left: number) => {
    timer.current = setTimeout(async () => {
      try {
        const p = await api.get<PaymentView>(`/v1/payments/${id}`);
        setPayment(p);
        if (p.status === 'SUCCESSFUL') return setPhase('done');
        if (p.status === 'FAILED') {
          key.current = null; // trying again is a new purchase
          setPhase('form');
          return setError('The M-PESA payment was not completed. No tokens were bought.');
        }
      } catch {
        // keep waiting
      }
      if (left > 0) poll(id, left - 1);
      else setPhase('stalled'); // not a failure: the server keeps checking with M-PESA
    }, POLL_MS);
  };

  const buy = async () => {
    if (busy) return; // one request at a time: a second tap must not send a second prompt
    setError(null);
    if (!shillings) return setError('Enter an amount in whole shillings');
    if (!normalizeKenyanPhone(phone)) return setError('Enter a valid M-PESA number');
    key.current ??= Crypto.randomUUID(); // same key for retries of this purchase: never charged twice
    setBusy(true);
    try {
      const p = await api.post<PaymentView>('/v1/payments/tokens', { shillings, phone, idempotencyKey: key.current, ...(chosen ? { provider: chosen } : {}) });
      setPayment(p);
      setPhase('waiting');
      poll(p.id, POLL_TRIES);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The purchase could not be started. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'done' && payment) {
    return (
      <Screen footer={<PrimaryButton title="Done" onPress={goBack} />}>
        <ScreenHeader title="Buy Tokens" />
        <View style={{ alignItems: 'center', marginTop: s(80) }}>
          <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ fontSize: s(56) }}>🎉</Text>
          <T variant="title" center style={{ marginTop: s(16), fontSize: s(24) }}>{payment.tokens} tokens added</T>
          <T variant="body" color={colors.textSecondary} center style={{ marginTop: s(8) }}>Paid Ksh {payment.amount} with M-PESA</T>
        </View>
      </Screen>
    );
  }

  return (
    <Screen footer={phase === 'form' ? <PrimaryButton title={shillings ? `Buy ${shillings} Tokens` : 'Buy Tokens'} onPress={() => void buy()} disabled={!shillings} loading={busy} /> : undefined}>
      <ScreenHeader title="Buy Tokens" />
      {phase === 'waiting' ? (
        <View style={{ alignItems: 'center', marginTop: s(90) }}>
          <ActivityIndicator color={colors.green} size="large" />
          <T variant="bodyStrong" center style={{ marginTop: s(18), fontSize: s(19) }}>Check your phone</T>
          <T variant="body" color={colors.textSecondary} center style={{ marginTop: s(8), lineHeight: s(22) }}>
            Enter your M-PESA PIN in the prompt to pay Ksh {payment?.amount ?? shillings}.
          </T>
        </View>
      ) : phase === 'stalled' && payment ? (
        <View style={{ alignItems: 'center', marginTop: s(90) }}>
          <T variant="bodyStrong" center style={{ fontSize: s(19) }}>Waiting for M-PESA</T>
          <T variant="body" color={colors.textSecondary} center style={{ marginTop: s(8), lineHeight: s(22) }}>
            M-PESA has not confirmed this payment yet. If you paid, your {payment.tokens} tokens are added automatically as soon as it does — you can leave this page.
          </T>
          <PrimaryButton title="Check again" onPress={() => { setPhase('waiting'); poll(payment.id, POLL_TRIES); }} style={{ marginTop: s(24), alignSelf: 'stretch' }} />
          <View style={{ marginTop: s(12), alignSelf: 'stretch' }}><OutlineButton title="Done" onPress={goBack} /></View>
        </View>
      ) : (
        <>
          <Field label="Amount" value={amount} onChangeText={(v) => { setAmount(v); setError(null); key.current = null; }} placeholder="0" keyboardType="number-pad"
            right={<T variant="body">Ksh</T>} hint={shillings ? `You get ${shillings} tokens` : '1 token = Ksh 1'} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: s(12), marginTop: s(14) }}>
            {AMOUNTS.map((a) => (
              <Pressable key={a} accessibilityRole="button" accessibilityLabel={`Ksh ${a}`} onPress={() => { setAmount(String(a)); key.current = null; }} style={[styles.chip, { backgroundColor: colors.raised }]}>
                <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.text, fontSize: s(16) }}>Ksh {a}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Field label="M-PESA number" value={phone} onChangeText={(v) => { setPhone(v); key.current = null; }} keyboardType="phone-pad" placeholder="07XX XXX XXX" />
          {(providers.data?.providers.length ?? 0) > 1 ? (
            <View style={{ marginTop: s(20) }}>
              <T variant="label" color={colors.textSecondary}>Pay through</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s(10), marginTop: s(10) }}>
                {providers.data!.providers.map((p) => (
                  <Pressable key={p} accessibilityRole="radio" aria-checked={chosen === p} accessibilityState={{ checked: chosen === p }} onPress={() => { setProvider(p); key.current = null; }}
                    style={[styles.chip, { borderWidth: 1.4, borderColor: chosen === p ? colors.green : colors.inputBorder, backgroundColor: colors.surface }]}>
                    <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.text, fontSize: s(15) }}>{p}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {providers.error ? <T variant="caption" color={colors.red} style={{ marginTop: s(14) }}>{providers.error}</T> : null}
          {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(14) }}>{error}</T> : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: s(8), paddingHorizontal: s(18), paddingVertical: s(11) },
});
