import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Image,
  Platform,
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
import { FIXED_TEXT, s } from '@/theme/scale';

/** Browsers draw a focus ring around inputs; the reference shows only the green border. */
export const WEB_NO_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as TextStyle;

// ---------------------------------------------------------------- text

type Variant = 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption' | 'amount';

const VARIANTS: Record<Variant, TextStyle> = {
  title: { fontSize: s(21), fontWeight: '500' },
  heading: { fontSize: s(20), fontWeight: '600' },
  body: { fontSize: s(18) },
  bodyStrong: { fontSize: s(18), fontWeight: '600' },
  label: { fontSize: s(17) },
  caption: { fontSize: s(15) },
  amount: { fontSize: s(30), fontWeight: '600' },
};

export function T({
  children, variant = 'body', color, style, numberOfLines, center,
}: { children: ReactNode; variant?: Variant; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; center?: boolean }) {
  const { colors } = useTheme();
  return (
    <Text maxFontSizeMultiplier={FIXED_TEXT} numberOfLines={numberOfLines} style={[VARIANTS[variant], { color: color ?? colors.text }, center && { textAlign: 'center' }, style]}>
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
        <ScrollView contentContainerStyle={[{ paddingHorizontal: s(21), paddingBottom: s(24) }, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, paddingHorizontal: s(21) }, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={{ paddingHorizontal: s(21), paddingBottom: s(12) }}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function CircleButton({ onPress, children, size = 50, label }: { onPress?: () => void; children: ReactNode; size?: number; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: s(size), height: s(size), borderRadius: s(size) / 2, alignItems: 'center', justifyContent: 'center',
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
        <ChevronLeftIcon color={colors.text} size={26} />
      </CircleButton>
      <T variant="title" style={styles.headerTitle} numberOfLines={1}>{title ?? ''}</T>
      <View style={{ minWidth: s(40), alignItems: 'flex-end' }}>{right}</View>
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
        <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: disabled ? colors.buttonDisabledText : '#FFFFFF', fontSize: s(18.5), fontWeight: '500' }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function OutlineButton({ title, onPress }: { title: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.outlineButton, { borderColor: colors.green, opacity: pressed ? 0.7 : 1 }]}>
      <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.green, fontSize: s(18), fontWeight: '500' }}>{title}</Text>
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
    <View style={{ marginTop: s(18) }}>
      {label ? <T variant="label" style={{ marginBottom: s(14), fontSize: s(18) }}>{label}</T> : null}
      <View style={[styles.input, { borderColor, borderWidth: focused && !error && focusedBorder ? 2 : 1.2, backgroundColor: input.editable === false ? colors.raised : 'transparent' }]}>
        {left}
        <TextInput maxFontSizeMultiplier={FIXED_TEXT}
          placeholderTextColor={colors.textSecondary}
          {...input}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
          style={[{ flex: 1, fontSize: s(17), color: colors.text, paddingVertical: 0 }, WEB_NO_OUTLINE, input.style]}
        />
        {right}
      </View>
      {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(6) }}>{error}</T> : null}
      {!error && hint ? <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(6) }}>{hint}</T> : null}
    </View>
  );
}

export function SegmentedTabs<K extends string>({ tabs, value, onChange, compact }: { tabs: { key: K; label: string; inert?: boolean }[]; value: K; onChange: (k: K) => void; compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segment, compact && { padding: s(4) }, { backgroundColor: colors.segmentTrack }]}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => !t.inert && onChange(t.key)}
            style={[styles.segmentItem, compact && { height: s(40) }, active && { backgroundColor: colors.greenTab }]}
          >
            <Text maxFontSizeMultiplier={FIXED_TEXT} numberOfLines={1} style={{ fontSize: s(compact ? 17 : 18), fontWeight: compact ? '400' : '500', color: active ? '#FFFFFF' : colors.text }}>{t.label}</Text>
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

export function Avatar({ name, size = 56, fontSize, photo }: { name: string; size?: number; fontSize?: number; photo?: string | null }) {
  const { colors } = useTheme();
  const palette = AVATAR_COLORS[colors.mode];
  const [bg, fg] = palette[hash(name) % palette.length]!;
  if (photo) {
    return <Image source={{ uri: photo }} accessibilityIgnoresInvertColors style={{ width: s(size), height: s(size), borderRadius: s(size) / 2, backgroundColor: bg }} />;
  }
  return (
    <View style={{ width: s(size), height: s(size), borderRadius: s(size) / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: fg, fontSize: s(fontSize ?? size * 0.36), fontWeight: '600' }}>{initialsOf(name)}</Text>
    </View>
  );
}

export function IconCircle({ children, size = 56 }: { children: ReactNode; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: s(size), height: s(size), borderRadius: s(size) / 2, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </View>
  );
}

/** Card with the cyan→green top edge and a badge circle overlapping it (confirm / success / detail cards). */
export function BadgeCard({ badge, children, style, badgeSize = 94, contentTop }: {
  badge: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle>; badgeSize?: number;
  /** Distance from the card's top edge to the content (defaults to below the badge). */
  contentTop?: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={[{ marginTop: s(76) }, style]}>
      <View style={[styles.badgeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <LinearGradient colors={colors.edgeGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.topEdge} />
        <View style={{ paddingTop: s(contentTop ?? badgeSize / 2 + 37) }}>{children}</View>
      </View>
      <View style={[styles.badge, { width: s(badgeSize), height: s(badgeSize), borderRadius: s(badgeSize / 2), top: -s(badgeSize / 2),  backgroundColor: colors.mode === 'dark' ? colors.raised : colors.raised, borderColor: colors.mode === 'dark' ? '#424C58' : '#D5DCE2' }]}>
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
      <View style={{ flex: 1, padding: s(20) }}>{children}</View>
    </View>
  );
}

export function Row({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: s(12), borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth * 2, borderBottomColor: colors.divider }}>
      <T variant="caption" color={colors.textSecondary} style={{ fontSize: s(15.5) }}>{label}</T>
      {typeof value === 'string' ? <T variant="bodyStrong" style={{ marginTop: s(6), fontSize: s(21) }}>{value}</T> : value}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: s(10) },
  headerTitle: { flex: 1, textAlign: 'center', marginHorizontal: s(8) },
  primaryButton: { height: s(60), borderRadius: s(10), alignItems: 'center', justifyContent: 'center' },
  outlineButton: { height: s(60), borderRadius: s(10), borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: s(72), borderRadius: s(12), paddingHorizontal: s(20), flexDirection: 'row', alignItems: 'center', gap: s(10) },
  segment: { flexDirection: 'row', borderRadius: s(40), padding: s(6) },
  segmentItem: { flex: 1, height: s(62), borderRadius: s(32), alignItems: 'center', justifyContent: 'center', paddingHorizontal: s(6) },
  badgeCard: { borderRadius: s(14), overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: s(3) },
  badge: { position: 'absolute', top: s(-46), alignSelf: 'center', width: s(94), height: s(94), borderRadius: s(47), borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  edgeCard: { borderRadius: s(18), overflow: 'hidden', flexDirection: 'row' },
  leftEdge: { width: s(4) },
});

/** Bottom sheet with grabber, back button and centred title (reference: 02-profile-settings/04, 05). */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} accessibilityLabel="Close" />
      <View style={[sheetStyles.sheet, { backgroundColor: colors.mode === 'dark' ? '#1B1B1B' : colors.screen }]}>
        <View style={[sheetStyles.grabber, { backgroundColor: colors.textMuted }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: s(18) }}>
          <CircleButton label="Back" onPress={onClose} size={46}><ChevronLeftIcon color={colors.text} size={22} /></CircleButton>
          <T variant="title" style={{ flex: 1, textAlign: 'center', marginRight: s(46), fontSize: s(19) }}>{title}</T>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** A tappable row inside a Sheet: icon tile + label. */
export function SheetRow({ icon, label, onPress, color }: { icon: ReactNode; label: string; onPress: () => void; color?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [sheetStyles.row, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={[sheetStyles.rowIcon, { backgroundColor: colors.raised }]}>{icon}</View>
      <T variant="body" color={color} style={{ fontSize: s(17), fontWeight: '500', marginLeft: s(16) }}>{label}</T>
    </Pressable>
  );
}

const sheetStyles = StyleSheet.create({
  sheet: { borderTopLeftRadius: s(26), borderTopRightRadius: s(26), paddingHorizontal: s(20), paddingBottom: s(34) },
  grabber: { alignSelf: 'center', width: s(56), height: s(5), borderRadius: s(3), marginTop: s(10) },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(12) },
  rowIcon: { width: s(42), height: s(42), borderRadius: s(10), alignItems: 'center', justifyContent: 'center' },
});
