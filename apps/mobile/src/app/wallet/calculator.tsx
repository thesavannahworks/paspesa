/**
 * Token Calculator: what a simulation costs in tokens, and how much a number of tokens can pay for.
 * Uses the pricing delivered by the server (deps.config.pricing, the same rules that charge simulations),
 * resolved for this account and transaction type — never fixed numbers.
 */
import { calculateTokens, formatAmount, type PricingRule, type SimulationType } from '@paspesa/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { EdgeCard, Field, Screen, ScreenHeader, SegmentedTabs, T } from '@/components/ui';
import { useAccount, useAppState } from '@/services/AppState';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

const TYPES: { key: SimulationType; label: string }[] = [
  { key: 'SEND_MONEY', label: 'Send' },
  { key: 'BUY_GOODS', label: 'Till' },
  { key: 'PAYBILL', label: 'Paybill' },
  { key: 'POCHI', label: 'Pochi' },
  { key: 'AIRTIME', label: 'Airtime' },
];

const whole = (v: string) => Number.parseInt(v.replace(/\D/g, ''), 10) || 0;
/** Whole shillings or tokens with thousands separators (formatAmount adds ".00"). */
const num = (n: number) => formatAmount(n).slice(0, -3);
const plural = (n: number) => `${num(n)} token${n === 1 ? '' : 's'}`;

/** The rule in plain words. */
function describe(rule: PricingRule | null): string {
  if (!rule) return 'This type of transaction is free.';
  const free = rule.freeThreshold > 0 ? `Up to Ksh ${num(rule.freeThreshold)} is free. ` : '';
  switch (rule.formula) {
    case 'FULL_AMOUNT':
      return `${free}Above that, 1 token for every Ksh ${rule.amountPerToken} of the amount (rounded up).`;
    case 'EXCESS_AMOUNT':
      return `${free}Above that, 1 token for every Ksh ${rule.amountPerToken} over Ksh ${num(rule.freeThreshold)} (rounded up).`;
    case 'TIERED':
      return (rule.tiers ?? [])
        .map((t) => `Ksh ${num(t.min)}${t.max === null ? ' and above' : ` – ${num(t.max)}`}: ${plural(t.tokens)}`)
        .join('\n');
  }
}

export default function Calculator() {
  const { colors } = useTheme();
  const { deps } = useAppState();
  const account = useAccount();
  const [type, setType] = useState<SimulationType>('SEND_MONEY');
  const [amount, setAmount] = useState('100');
  const [tokens, setTokens] = useState('20');

  const [at] = useState(() => deps.clock.now());
  const calc = (() => {
    try {
      return calculateTokens(deps.config.pricing, deps.config.monetization, {
        accountId: account.id, type, amount: whole(amount), tokens: whole(tokens), at, limit: deps.config.maxOpeningBalance,
      });
    } catch {
      return null; // no pricing rule delivered yet
    }
  })();

  return (
    <Screen>
      <ScreenHeader title="Token Calculator" />
      <T variant="body" color={colors.textSecondary} style={{ marginTop: s(12), lineHeight: s(22) }}>
        See what a simulation costs in tokens, or how much you can simulate with the tokens you have.
      </T>

      <View style={{ marginTop: s(18) }}>
        <SegmentedTabs compact tabs={TYPES} value={type} onChange={setType} />
      </View>

      {!calc ? (
        <T variant="body" color={colors.textSecondary} style={{ marginTop: s(20) }}>
          Prices are not available yet. Connect to the internet and try again.
        </T>
      ) : (
        <>
          <EdgeCard style={{ marginTop: s(18) }}>
            <T variant="bodyStrong" style={{ fontSize: s(17) }}>What does it cost?</T>
            <Field label="Simulation amount" value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad" placeholder="0" right={<T variant="body">Ksh</T>} />
            <View style={[styles.result, { backgroundColor: colors.greenSoft }]}>
              <T variant="amount" color={colors.green} style={{ fontSize: s(26) }}>{plural(calc.tokenCost)}</T>
              <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(4) }}>
                {calc.tokenCost === 0 ? 'Free' : `or Ksh ${num(calc.shillings)} paid with M-PESA`}
              </T>
            </View>
          </EdgeCard>

          <EdgeCard style={{ marginTop: s(16) }}>
            <T variant="bodyStrong" style={{ fontSize: s(17) }}>How much can I simulate?</T>
            <Field label="Tokens" value={tokens} onChangeText={(v) => setTokens(v.replace(/\D/g, '').slice(0, 7))}
              keyboardType="number-pad" placeholder="0" />
            <View style={[styles.result, { backgroundColor: colors.greenSoft }]}>
              <T variant="amount" color={colors.green} style={{ fontSize: s(26) }}>Ksh {num(calc.maxAmount)}</T>
              <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(4) }}>largest amount in one simulation</T>
            </View>
          </EdgeCard>

          <View style={{ marginTop: s(20), marginBottom: s(12) }}>
            <T variant="bodyStrong">How it is priced</T>
            <T variant="body" color={colors.textSecondary} style={{ marginTop: s(6), lineHeight: s(22) }}>{describe(calc.rule)}</T>
            <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(8), lineHeight: s(19) }}>
              1 token = Ksh {deps.config.monetization.shillingsPerToken}. Recharging your simulated balance is always free.
            </T>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { marginTop: s(16), borderRadius: s(8), padding: s(16), alignItems: 'center' },
});
