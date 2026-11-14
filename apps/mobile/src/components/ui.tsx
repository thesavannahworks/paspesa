import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from '@/icons';
import { AVATAR_COLORS } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

// ---------------------------------------------------------------- text

type Variant = 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption' | 'amount';

const VARIANTS: Record<Variant, TextStyle> = {
  title: { fontSize: 20, fontWeight: '500' },
  heading: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 16 },
  bodyStrong: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 15 },
  caption: { fontSize: 13 },
  amount: { fontSize: 30, fontWeight: '700' },
};

export function T({
  children, variant = 'body', color, style, numberOfLines, center,
}: { children: ReactNode; variant?: Variant; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; center?: boolean }) {
  const { colors } = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[VARIANTS[variant], { color: color ?? colors.text }, center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------- layout

export function Screen({
  children, scroll = true, background, contentStyle, footer,
}: { children: ReactNode; scroll?: boolean; background?: 'page' | 'screen'; contentStyle?: StyleProp<ViewStyle>; footer?: ReactNode }) {
  const { colors } = useTheme();
  const bg = background === 'page' ? colors.page : colors.screen;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[{ paddingHorizontal: 16, paddingBottom: 24 }, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, paddingHorizontal: 16 }, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function CircleButton({ onPress, children, size = 40, label }: { onPress?: () => void; children: ReactNode; size?: number; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.mode === 'dark' ? colors.surface : colors.raised, opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

export function ScreenHeader({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <CircleButton label="Back" onPress={onBack ?? (() => router.back())}>
        <ChevronLeftIcon color={colors.text} size={22} />
      </CircleButton>
      <T variant="title" style={styles.headerTitle} numberOfLines={1}>{title ?? ''}</T>
      <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

// ---------------------------------------------------------------- buttons

export function PrimaryButton({ title, onPress, disabled, loading, style }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: disabled ? colors.buttonDisabled : colors.green, opacity: pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : (
        <Text style={{ color: disabled ? colors.buttonDisabledText : '#FFFFFF', fontSize: 17, fontWeight: '600' }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function OutlineButton({ title, onPress }: { title: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.outlineButton, { borderColor: colors.green, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={{ color: colors.green, fontSize: 17, fontWeight: '500' }}>{title}</Text>
    </Pressable>
  );
}

/**
 * Renders a reference-screen element that has no agreed behaviour yet.
 * It looks exactly like the reference but does nothing when tapped (owner instruction).
 */
export function Inert({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style} accessibilityState={{ disabled: true }} accessibilityHint="Not available yet">
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- inputs

export function Field({
  label, error, hint, left, right, focusedBorder = true, ...input
}: TextInputProps & { label?: string; error?: string; hint?: string; left?: ReactNode; right?: ReactNode; focusedBorder?: boolean }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.red : focused && focusedBorder ? colors.inputBorderFocused : colors.inputBorder;
  return (
    <View style={{ marginTop: 18 }}>
      {label ? <T variant="label" style={{ marginBottom: 10 }}>{label}</T> : null}
      <View style={[styles.input, { borderColor, borderWidth: focused && !error && focusedBorder ? 2 : 1.2, backgroundColor: input.editable === false ? colors.raised : 'transparent' }]}>
        {left}
        <TextInput
          placeholderTextColor={colors.textSecondary}
          {...input}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
          style={[{ flex: 1, fontSize: 17, color: colors.text, paddingVertical: 0 }, input.style]}
        />
        {right}
      </View>
      {error ? <T variant="caption" color={colors.red} style={{ marginTop: 6 }}>{error}</T> : null}
      {!error && hint ? <T variant="caption" color={colors.textSecondary} style={{ marginTop: 6 }}>{hint}</T> : null}
    </View>
  );
}

export function SegmentedTabs<K extends string>({ tabs, value, onChange }: { tabs: Array<{ key: K; label: string; inert?: boolean }>; value: K; onChange: (k: K) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: colors.segmentTrack }]}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => !t.inert && onChange(t.key)}
            style={[styles.segmentItem, active && { backgroundColor: colors.greenTab }]}
          >
            <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '500', color: active ? '#FFFFFF' : colors.text }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- avatars & cards

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '')).toUpperCase();
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, size = 56, fontSize }: { name: string; size?: number; fontSize?: number }) {
  const { colors } = useTheme();
  const palette = AVATAR_COLORS[colors.mode];
  const [bg, fg] = palette[hash(name) % palette.length]!;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: fg, fontSize: fontSize ?? size * 0.36, fontWeight: '600' }}>{initialsOf(name)}</Text>
    </View>
  );
}

export function IconCircle({ children, size = 56 }: { children: ReactNode; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </View>
  );
}

/** Card with the cyan→green top edge and a badge circle overlapping it (confirm / success / detail cards). */
export function BadgeCard({ badge, children, style }: { badge: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ marginTop: 66 }, style]}>
      <View style={[styles.badgeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <LinearGradient colors={colors.edgeGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.topEdge} />
        <View style={{ paddingTop: 72 }}>{children}</View>
      </View>
      <View style={[styles.badge, { backgroundColor: colors.mode === 'dark' ? colors.raised : colors.raised, borderColor: colors.mode === 'dark' ? '#424C58' : '#D5DCE2' }]}>
        {badge}
      </View>
    </View>
  );
}

/** Card with the green→cyan left edge (home balance cards). */
export function EdgeCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.edgeCard, { backgroundColor: colors.surface }, style]}>
      <LinearGradient colors={['#1EEB2C', '#27B9C8']} style={styles.leftEdge} />
      <View style={{ flex: 1, padding: 24, paddingLeft: 28 }}>{children}</View>
    </View>
  );
}

export function Row({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth * 2, borderBottomColor: colors.divider }}>
      <T variant="caption" color={colors.textSecondary}>{label}</T>
      {typeof value === 'string' ? <T variant="bodyStrong" style={{ marginTop: 4, fontSize: 18 }}>{value}</T> : value}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  headerTitle: { flex: 1, textAlign: 'center', marginHorizontal: 8 },
  primaryButton: { height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  outlineButton: { height: 48, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 56, borderRadius: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  segment: { flexDirection: 'row', borderRadius: 30, padding: 4 },
  segmentItem: { flex: 1, height: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeCard: { borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  badge: { position: 'absolute', top: -32, alignSelf: 'center', width: 66, height: 66, borderRadius: 33, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  edgeCard: { borderRadius: 18, overflow: 'hidden', flexDirection: 'row' },
  leftEdge: { width: 4 },
});
