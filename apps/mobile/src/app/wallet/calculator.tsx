/**
 * Token Calculator — Calculate tokens needed for a simulation or how much can be simulated with tokens.
 * Owner requirement (notes.md, item 6): help users understand token costs.
 */
import { useState } from 'react';
import { View, TextInput, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';
import { T } from '@/components/ui';
import { useAppState } from '@/services/AppState';
import type { SimulationType } from '@paspesa/core';

const SIM_TYPES: { type: SimulationType; label: string }[] = [
  { type: 'SEND_MONEY', label: 'Send Money' },
  { type: 'POCHI', label: 'Pochi la Biashara' },
  { type: 'BUY_GOODS', label: 'Buy Goods' },
  { type: 'PAYBILL', label: 'Paybill' },
  { type: 'AIRTIME', label: 'Airtime' },
  { type: 'WITHDRAW', label: 'Withdraw' },
];

export default function Calculator() {
  const { colors } = useTheme();
  const { deps } = useAppState();
  const [amount, setAmount] = useState('100');
  const [tokens, setTokens] = useState('20');
  const [selectedType, setSelectedType] = useState<SimulationType>('SEND_MONEY');

  // Simple pricing calculation based on FULL_AMOUNT formula: free up to KSh 20, then KSh 5 per token
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
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <Stack.Screen options={{ title: 'Token Calculator', headerShown: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: s(16) }}>
        {/* Header */}
        <View style={styles.section}>
          <T variant="heading" style={{ marginBottom: s(8) }}>
            Paspesa Token Calculator
          </T>
          <T variant="body" color={colors.textSecondary} style={{ marginBottom: s(24) }}>
            Calculate how many tokens you need for a simulation, or how much you can simulate with your tokens.
          </T>
        </View>

        {/* Shillings to Tokens */}
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <T variant="heading" style={{ marginBottom: s(8) }}>
            Shillings to Tokens
          </T>
          <T variant="caption" color={colors.textSecondary} style={{ marginBottom: s(16) }}>
            Calculate tokens needed for a simulation
          </T>

          <T variant="label" style={styles.label}>
            Simulation Amount (KSh)
          </T>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.inputBorder, backgroundColor: colors.page }]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="Enter amount"
            placeholderTextColor={colors.textSecondary}
          />

          <T variant="label" style={styles.label}>
            Transaction Type
          </T>
          <View style={styles.typeSelector}>
            {SIM_TYPES.slice(0, 3).map((item) => (
              <Pressable
                key={item.type}
                onPress={() => setSelectedType(item.type)}
                style={[
                  styles.typeButton,
                  {
                    backgroundColor: selectedType === item.type ? colors.green : colors.surface,
                    borderColor: colors.inputBorder,
                  },
                ]}
              >
                <T variant="bodyStrong" color={selectedType === item.type ? '#FFFFFF' : colors.text}>
                  {item.label}
                </T>
              </Pressable>
            ))}
          </View>

          <View style={[styles.result, { backgroundColor: colors.raised }]}>
            <T variant="amount" color={colors.green}>
              {neededTokens} {neededTokens === 1 ? 'token' : 'tokens'}
            </T>
            <T variant="body" color={colors.textSecondary} style={{ marginTop: s(4) }}>
              Cost: KSh {cost.toFixed(2)}
            </T>
          </View>
        </View>

        {/* Tokens to Shillings */}
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <T variant="heading" style={{ marginBottom: s(8) }}>
            Tokens to Shillings
          </T>
          <T variant="caption" color={colors.textSecondary} style={{ marginBottom: s(16) }}>
            Calculate how much you can simulate with your tokens
          </T>

          <T variant="label" style={styles.label}>
            Available Tokens
          </T>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.inputBorder, backgroundColor: colors.page }]}
            value={tokens}
            onChangeText={setTokens}
            keyboardType="numeric"
            placeholder="Enter tokens"
            placeholderTextColor={colors.textSecondary}
          />

          <View style={[styles.result, { backgroundColor: colors.raised }]}>
            <T variant="amount" color={colors.green}>
              Up to KSh {maxAmount}
            </T>
            <T variant="body" color={colors.textSecondary} style={{ marginTop: s(4) }}>
              Based on the pricing formula
            </T>
          </View>
        </View>

        {/* Pricing Info */}
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <T variant="heading" style={{ marginBottom: s(8) }}>
            Current Pricing
          </T>
          <T variant="body" color={colors.textSecondary} style={{ marginBottom: s(12) }}>
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
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: s(24),
  },
  card: {
    borderRadius: s(12),
    padding: s(16),
    marginBottom: s(16),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: s(2) },
    shadowOpacity: 0.1,
    shadowRadius: s(4),
    elevation: 2,
  },
  label: {
    marginBottom: s(8),
    marginTop: s(12),
  },
  input: {
    borderWidth: 1,
    borderRadius: s(8),
    padding: s(12),
    fontSize: s(16),
  },
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: s(8),
    marginBottom: s(16),
    gap: s(8),
  },
  typeButton: {
    borderWidth: 1,
    borderRadius: s(8),
    padding: s(12),
    paddingHorizontal: s(16),
  },
  result: {
    borderRadius: s(8),
    padding: s(16),
    marginTop: s(16),
    alignItems: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: s(8),
  },
});
