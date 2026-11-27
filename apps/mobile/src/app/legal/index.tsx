import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Screen, ScreenHeader, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

/**
 * Legal documents hub - Privacy Policy, Terms of Service, Data Protection
 */
export default function LegalIndexScreen() {
  const { colors } = useTheme();

  return (
    <Screen background="page" refreshable={false}>
      <ScreenHeader title="Legal" />
      <View style={{ paddingTop: s(12) }}>
        <T variant="heading" style={{ fontSize: s(24), marginBottom: s(12) }}>Legal Information</T>
        <T variant="body" color={colors.textSecondary} style={{ lineHeight: s(22), marginBottom: s(24) }}>
          Review our legal documents to understand how we handle your data and what terms apply when using Paspesa.
        </T>

        <LegalItem
          title="Privacy Policy"
          description="How we collect, use, and protect your personal information"
          onPress={() => router.push('/legal/privacy')}
        />
        <LegalItem
          title="Terms of Service"
          description="The rules and conditions for using Paspesa"
          onPress={() => router.push('/legal/terms')}
        />
        <LegalItem
          title="Data Protection"
          description="Your rights and how we comply with data protection laws"
          onPress={() => router.push('/legal/data-protection')}
        />
      </View>
    </Screen>
  );
}

function LegalItem({
  title,
  description,
  onPress,
}: {
  title: string;
  description: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={[styles.item, { backgroundColor: colors.surface }]}
    >
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" style={{ fontSize: s(18) }}>{title}</T>
        <T variant="label" color={colors.textSecondary} style={{ marginTop: s(4), fontSize: s(15), lineHeight: s(20) }}>
          {description}
        </T>
      </View>
      <T variant="body" color={colors.textSecondary} style={{ marginLeft: s(12) }}>→</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: s(14),
    padding: s(16),
    marginBottom: s(12),
  },
});
