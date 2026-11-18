/**
 * "How do you want to pay?" — shown after the confirmation page, before the PIN, when a simulation costs
 * tokens and payments are switched on (owner design, 2026-11-17; White Paper §26: chosen per simulation).
 *
 *  - Paspesa tokens: spent from the tokens set aside on this phone (works offline, §29).
 *  - M-PESA: an STK prompt for the token cost in shillings (1 token = KSh 1); the simulation continues to the
 *    PIN only once the server has verified the payment (§32).
 */
import { formatKsh, toLocalPhone, type SimulationType } from '@paspesa/core';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, Sheet, T } from '@/components/ui';
import { MoneyMethodIcon, TokenIcon } from '@/icons';
import { ApiError, useApi } from '@/services/api';
import { useAccount, useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

/** TOKENS: set aside on this phone (offline). WALLET: the central balance (online, nothing set aside). */
export type PaymentChoice = { paymentMethod: 'TOKENS' } | { paymentMethod: 'WALLET' } | { paymentMethod: 'DIRECT'; directPaymentId: string };

interface DirectPayment {
  id: string;
  status: 'INITIATED' | 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  simulationStatus: string;
  amount: number;
}

const POLL_MS = 3_000;
const POLL_LIMIT = 40; // ~2 minutes

export function PaySheet({
  visible, tokenCost, simulation, onClose, onChosen,
}: {
  visible: boolean;
  tokenCost: number;
  /** The journey's operation ID, type and simulated amount (the server prices it itself). */
  simulation: { operationId: string; type: SimulationType; amount: number };
  onClose: () => void;
  onChosen: (choice: PaymentChoice) => void;
}) {
  const { colors } = useTheme();
  const api = useApi();
  const account = useAccount();
  const allocation = account.tokenAllocation ?? null;
  const [openedAt] = useState(() => Date.now());
  const expired = !!allocation && Date.parse(allocation.authorizationExpiresAt) < openedAt;
  const allocationOk = !!allocation && !expired && allocation.remaining >= tokenCost;
  // Online with nothing usable set aside: pay from the central balance (less what is already chosen
  // to be paid from it but not uploaded yet).
  const { transactions } = useAppState();
  const [central, setCentral] = useState<number | null>(null);
  const pendingCentral = transactions.filter((t) => t.paymentMethod === 'WALLET' && t.syncStatus !== 'SYNCED').reduce((n, t) => n + (t.pricing?.tokenCost ?? 0), 0);
  const centralAvailable = central === null ? null : Math.max(0, central - pendingCentral);
  useEffect(() => {
    if (!visible || allocationOk || !api.available) return;
    let live = true;
    api.get<{ balances: { total: number } }>('/v1/wallet').then((w) => { if (live) setCentral(w.balances.total); }, () => { if (live) setCentral(null); });
    return () => { live = false; };
  }, [visible, allocationOk, api]);
  const centralOk = !allocationOk && centralAvailable !== null && centralAvailable >= tokenCost;
  const tokensOk = allocationOk || centralOk;
  // Tokens when they cover it (set aside, or the central balance once known), else M-PESA; the user may switch.
  const [picked, setMethod] = useState<'TOKENS' | 'DIRECT' | null>(null);
  const method = picked ?? (tokensOk ? 'TOKENS' : 'DIRECT');
  const [phase, setPhase] = useState<'choose' | 'waiting' | 'stalled'>('choose');
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<DirectPayment | null>(null);
  const polls = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const plural = (n: number) => `${n} token${n === 1 ? '' : 's'}`;
  const tokensSub = allocationOk ? `Available on this phone: ${plural(allocation!.remaining)}`
    : centralAvailable !== null ? `Your balance: ${plural(centralAvailable)}${centralOk ? '' : ' — not enough'}`
    : api.available ? 'Checking your balance…'
    : !allocation ? 'Offline and no tokens set aside on this phone'
    : expired ? 'Connect to the internet to renew your tokens'
    : `Available on this phone: ${plural(allocation.remaining)} — not enough`;

  const poll = (id: string) => {
    timer.current = setTimeout(async () => {
      try {
        const p = await api.get<DirectPayment>(`/v1/payments/${id}`);
        setPayment(p);
        if (p.status === 'SUCCESSFUL' && p.simulationStatus === 'AUTHORIZED') {
          setPhase('choose');
          onChosen({ paymentMethod: 'DIRECT', directPaymentId: p.id });
          return;
        }
        if (p.status === 'FAILED') {
          setPhase('choose');
          setError('The M-PESA payment was not completed. You have not been charged for this simulation.');
          return;
        }
      } catch {
        // offline for a moment: keep waiting
      }
      polls.current += 1;
      if (polls.current >= POLL_LIMIT) setPhase('stalled');
      else poll(id);
    }, POLL_MS);
  };

  const payDirect = async () => {
    setError(null);
    try {
      const p = await api.post<{ payment: DirectPayment }>('/v1/payments/simulation', {
        simulationId: simulation.operationId,
        type: simulation.type,
        amount: simulation.amount,
        phone: account.phoneNumber,
        idempotencyKey: `sim-${simulation.operationId}`,
      });
      setPayment(p.payment);
      polls.current = 0;
      setPhase('waiting');
      poll(p.payment.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The payment could not be started. Please try again.');
    }
  };

  const onContinue = () => (method === 'TOKENS' ? onChosen({ paymentMethod: allocationOk ? 'TOKENS' : 'WALLET' }) : void payDirect());

  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    setPhase('choose');
    setError(null);
    onClose();
  };

  return (
    <Sheet visible={visible} title="How do you want to pay?" onClose={close}>
      {phase === 'choose' ? (
        <View style={{ marginTop: s(10) }}>
          <T variant="body" color={colors.textSecondary} center style={{ fontSize: s(16) }}>
            This simulation costs {tokenCost} token{tokenCost === 1 ? '' : 's'} ({formatKsh(tokenCost)})
          </T>
          <Option
            selected={method === 'TOKENS'}
            disabled={!tokensOk}
            onPress={() => setMethod('TOKENS')}
            icon={<TokenIcon size={30} />}
            title="Paspesa Tokens"
            sub={tokensSub}
          />
          <Option
            selected={method === 'DIRECT'}
            disabled={!api.available}
            onPress={() => setMethod('DIRECT')}
            icon={<MoneyMethodIcon size={30} />}
            title="M-PESA"
            sub={api.available ? `Pay ${formatKsh(tokenCost)} · prompt to ${toLocalPhone(account.phoneNumber)}` : 'Needs the Paspesa server'}
          />
          {!tokensOk && api.available ? (
            <Pressable accessibilityRole="link" onPress={() => { close(); router.push('/wallet'); }} style={{ marginTop: s(12), alignSelf: 'center' }}>
              <T variant="label" color={colors.green}>Set aside tokens from your balance</T>
            </Pressable>
          ) : null}
          {error ? <T variant="caption" color={colors.red} center style={{ marginTop: s(12) }}>{error}</T> : null}
          <PrimaryButton title="Continue" onPress={onContinue} disabled={method === 'TOKENS' ? !tokensOk : !api.available} style={{ marginTop: s(22) }} />
        </View>
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: s(26) }}>
          {phase === 'waiting' ? <ActivityIndicator color={colors.green} size="large" /> : null}
          <T variant="bodyStrong" center style={{ marginTop: s(16), fontSize: s(18) }}>
            {phase === 'waiting' ? 'Check your phone' : 'Still waiting for M-PESA'}
          </T>
          <T variant="body" color={colors.textSecondary} center style={{ marginTop: s(8), fontSize: s(16), lineHeight: s(22) }}>
            {phase === 'waiting'
              ? `Enter your M-PESA PIN in the prompt to pay ${formatKsh(payment?.amount ?? tokenCost)}.`
              : 'If you completed the payment, check again. Otherwise you can close this and try later.'}
          </T>
          {phase === 'stalled' && payment ? (
            <PrimaryButton title="Check again" onPress={() => { polls.current = 0; setPhase('waiting'); poll(payment.id); }} style={{ marginTop: s(20), alignSelf: 'stretch' }} />
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

function Option({ selected, disabled, onPress, icon, title, sub }: { selected: boolean; disabled: boolean; onPress: () => void; icon: ReactNode; title: string; sub: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      disabled={disabled}
      onPress={onPress}
      style={[styles.option, {
        borderColor: selected && !disabled ? colors.green : colors.inputBorder,
        backgroundColor: selected && !disabled ? colors.paymentCardSelected : colors.paymentCard,
        opacity: disabled ? 0.55 : 1,
      }]}
    >
      {selected && !disabled ? <View style={[styles.corner, { borderTopColor: colors.green }]}><Text maxFontSizeMultiplier={FIXED_TEXT} style={styles.tick}>✓</Text></View> : null}
      {icon}
      <View style={{ marginLeft: s(14), flex: 1 }}>
        <T variant="body" style={{ fontSize: s(18), fontWeight: '500' }}>{title}</T>
        <T variant="label" color={colors.textSecondary} style={{ marginTop: s(4), fontSize: s(15) }}>{sub}</T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.4, borderRadius: s(10), paddingHorizontal: s(14), paddingVertical: s(14), marginTop: s(14), overflow: 'hidden' },
  // Same corner tick as the M-PESA payment-method cards (payments.tsx).
  corner: { position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderTopWidth: s(30), borderLeftWidth: s(30), borderLeftColor: 'transparent' },
  tick: { position: 'absolute', top: -s(29), left: -s(15), color: '#FFFFFF', fontSize: s(11), fontWeight: '700' },
});
