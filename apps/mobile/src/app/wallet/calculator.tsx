/**
 * Token Calculator — Calculate tokens needed for a simulation or how much can be simulated with tokens.
 * Owner requirement (notes.md, item 6): help users understand token costs.
 */
import { useState } from 'react';
import { View, TextInput, ScrollView, StyleSheet } from 'react-native';
import { EdgeCard, Screen, ScreenHeader, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';
import { useAppState } from '@/services/AppState';

export default function Calculator() {
  const { colors } = useTheme();
  const { deps } = useAppState();
  const [amount, setAmount] = useState('100');
  const [tokens, setTokens] = useState('20');

  // Simple pricing calculation based on FULL_AMOUNT formula
  const FREE_THRESHOLD = 20;
  const AMOUNT_PER_TOKEN = 5;
  const shillingsPerToken = deps.config.monetization.shillingsPerToken;

  const calculateTokens = (amountValue: number): { tokens: number; cost: number } => {
    if (amountValue <= FREE_THRESHOLD) {
      return { tokens: 0, cost: 0 };
    }
    const tokensNeeded = Math.ceil(amountValue / AMOUNT_PER_TOKEN);
    return { tokens: tokensNeeded, cost: tokensNeeded * shillingsPerToken };
  };

  const calculateAmount = (tokenValue: number): number => {
    if (tokenValue === 0) {
      return FREE_THRESHOLD;
    }
    return tokenValue * AMOUNT_PER_TOKEN;
  };

  const amountNum = parseInt(amount) || 0;
  const tokensNum = parseInt(tokens) || 0;
  const { tokens: neededTokens, cost } = calculateTokens(amountNum);
  const maxAmount = calculateAmount(tokensNum);

  return (
    <Screen>
      <ScreenHeader title="Token Calculator" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: s(16) }}>
        {/* Header */}
        <T variant="body" color={colors.textSecondary} style={{ marginBottom: s(24), lineHeight: s(22) }}>
          Calculate how many tokens you need for a simulation, or how much you can simulate with your tokens.
        </T>

        {/* Shillings to Tokens */}
        <EdgeCard style={{ marginTop: s(8) }}>
          <T variant="heading" style={{ fontSize: s(18), marginBottom: s(8) }}>
            Shillings to Tokens
          </T>
          <T variant="caption" color={colors.textSecondary} style={{ marginBottom: s(16) }}>
            Calculate tokens needed for a simulation
          </T>

          <T variant="label" style={{ marginBottom: s(8) }}>
            Simulation Amount (KSh)
          </T>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.inputBorder, backgroundColor: colors.raised }]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="Enter amount"
            placeholderTextColor={colors.textSecondary}
          />

          <View style={[styles.result, { backgroundColor: colors.greenSoft, marginTop: s(16) }]}>
            <T variant="amount" color={colors.green} style={{ fontSize: s(28) }}>
              {neededTokens}
            </T>
            <T variant="label" color={colors.green} style={{ marginTop: s(4) }}>
              {neededTokens === 1 ? 'token' : 'tokens'} needed
            </T>
            <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(8) }}>
              Cost: KSh {cost.toFixed(2)}
            </T>
          </View>
        </EdgeCard>

        {/* Tokens to Shillings */}
        <EdgeCard style={{ marginTop: s(16) }}>
          <T variant="heading" style={{ fontSize: s(18), marginBottom: s(8) }}>
            Tokens to Shillings
          </T>
          <T variant="caption" color={colors.textSecondary} style={{ marginBottom: s(16) }}>
            Calculate how much you can simulate with your tokens
          </T>

          <T variant="label" style={{ marginBottom: s(8) }}>
            Available Tokens
          </T>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.inputBorder, backgroundColor: colors.raised }]}
            value={tokens}
            onChangeText={setTokens}
            keyboardType="numeric"
            placeholder="Enter tokens"
            placeholderTextColor={colors.textSecondary}
          />

          <View style={[styles.result, { backgroundColor: colors.greenSoft, marginTop: s(16) }]}>
            <T variant="amount" color={colors.green} style={{ fontSize: s(28) }}>
              KSh {maxAmount}
            </T>
            <T variant="label" color={colors.green} style={{ marginTop: s(4) }}>
              Maximum simulation amount
            </T>
            <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(8) }}>
              Based on full amount pricing
            </T>
          </View>
        </EdgeCard>

        {/* Pricing Info */}
        <EdgeCard style={{ marginTop: s(16), marginBottom: s(32) }}>
          <T variant="heading" style={{ fontSize: s(18), marginBottom: s(8) }}>
            Current Pricing
          </T>
          <T variant="caption" color={colors.textSecondary} style={{ marginBottom: s(12) }}>
            Global default pricing rule
          </T>
          <View style={styles.infoRow}>
            <T variant="caption" color={colors.textSecondary}>
              Formula:
            </T>
            <T variant="body">Full Amount</T>
          </View>
          <View style={styles.infoRow}>
            <T variant="caption" color={colors.textSecondary}>
              Free threshold:
            </T>
            <T variant="body">KSh {FREE_THRESHOLD}</T>
          </View>
          <View style={styles.infoRow}>
            <T variant="caption" color={colors.textSecondary}>
              Amount per token:
            </T>
            <T variant="body">KSh {AMOUNT_PER_TOKEN}</T>
          </View>
          <View style={styles.infoRow}>
            <T variant="caption" color={colors.textSecondary}>
              Shillings per token:
            </T>
            <T variant="body">{shillingsPerToken}</T>
          </View>
        </EdgeCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: s(8),
    padding: s(12),
    fontSize: s(16),
  },
  result: {
    borderRadius: s(8),
    padding: s(20),
    alignItems: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: s(8),
    paddingVertical: s(4),
  },
});
