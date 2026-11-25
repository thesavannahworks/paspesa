import { Pressable, StyleSheet, View } from 'react-native';
import { T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

interface CheckboxProps {
  checked: boolean;
  onPress: () => void;
  label: React.ReactNode;
}

/**
 * Checkbox component for accepting terms
 */
export function Checkbox({ checked, onPress, label }: CheckboxProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.container}
      hitSlop={8}
    >
      <View
        style={[
          styles.box,
          {
            borderColor: checked ? colors.green : colors.border,
            backgroundColor: checked ? colors.green : 'transparent',
          },
        ]}
      >
        {checked && (
          <T variant="caption" style={{ color: '#FFFFFF', fontWeight: '700', fontSize: s(14) }}>
            ✓
          </T>
        )}
      </View>
      <View style={{ flex: 1, marginLeft: s(12) }}>{typeof label === 'string' ? <T variant="body" style={{ lineHeight: s(22) }}>{label}</T> : label}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  box: {
    width: s(24),
    height: s(24),
    borderRadius: s(6),
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: s(2),
  },
});
