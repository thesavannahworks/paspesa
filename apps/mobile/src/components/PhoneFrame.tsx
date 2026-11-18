/**
 * The phone drawn around the app on a computer (see LayoutFrame): the parts of a Samsung Galaxy-style body
 * that are not the app — side keys, status bar with the time, punch-hole camera and the usual icons.
 * Drawn with plain views (no images) in the app's units; the whole phone is scaled to fit the window.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT } from '@/theme/scale';
import { PHONE, PHONE_OUTER, SCREEN_RADIUS } from './LayoutFrame';

const BODY = '#17171A';
const EDGE = '#404044';
const KEY = '#2E2E32';

/** The phone's body around the screen, scaled about its centre to fit the window. */
export function phoneBodyStyle(scale: number): ViewStyle {
  return {
    width: PHONE_OUTER.width,
    height: PHONE_OUTER.height,
    flexShrink: 0,
    padding: PHONE.bezel - 3,
    borderRadius: PHONE.bodyRadius,
    borderWidth: 3,
    borderColor: EDGE,
    backgroundColor: BODY,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 48,
    shadowOffset: { width: 0, height: 24 },
    transform: [{ scale }],
  };
}

export const phoneScreenStyle: ViewStyle = { flex: 1, borderRadius: SCREEN_RADIUS, overflow: 'hidden' };

/** Volume keys and side key on the right edge, like a Galaxy S. */
export function PhoneKeys() {
  return (
    <>
      <View style={[styles.key, { top: 210, height: 130 }]} />
      <View style={[styles.key, { top: 370, height: 84 }]} />
    </>
  );
}

const clock = () => {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Status bar inside the screen: time on the left, camera in the middle, signal, Wi-Fi and battery. */
export function PhoneStatusBar() {
  const { colors } = useTheme();
  const [time, setTime] = useState(clock);
  useEffect(() => {
    const id = setInterval(() => setTime(clock()), 15_000);
    return () => clearInterval(id);
  }, []);
  const ink = colors.text;
  return (
    <View style={[styles.bar, { backgroundColor: colors.screen }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text maxFontSizeMultiplier={FIXED_TEXT} style={[styles.time, { color: ink }]}>{time}</Text>
      <View style={styles.camera}><View style={styles.lens} /></View>
      <View style={styles.icons}>
        <View style={styles.signal}>
          {[5, 8.5, 12, 15.5].map((h) => <View key={h} style={{ width: 3.6, height: h, marginLeft: 2, borderRadius: 1, backgroundColor: ink }} />)}
        </View>
        <View style={styles.wifi}>
          <View style={[styles.arc, { width: 20, height: 20, borderColor: ink }]} />
          <View style={[styles.arc, { width: 12, height: 12, borderColor: ink, top: 4 }]} />
          <View style={{ position: 'absolute', top: 10, width: 4, height: 4, borderRadius: 2, backgroundColor: ink }} />
        </View>
        <View style={[styles.battery, { borderColor: ink }]}>
          <View style={{ width: '78%', height: '100%', borderRadius: 1.5, backgroundColor: ink }} />
        </View>
        <View style={[styles.cap, { backgroundColor: ink }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  key: { position: 'absolute', right: -7, width: 5, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: KEY },
  bar: { height: PHONE.statusBar, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 30 },
  time: { fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },
  camera: { position: 'absolute', left: '50%', marginLeft: -9, top: 10, width: 18, height: 18, borderRadius: 9, backgroundColor: '#050506', borderWidth: 1.5, borderColor: '#2A2A2E', alignItems: 'center', justifyContent: 'center' },
  lens: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#1D2633' },
  icons: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' },
  signal: { flexDirection: 'row', alignItems: 'flex-end', height: 16, marginRight: 8 },
  wifi: { width: 20, height: 15, alignItems: 'center', overflow: 'hidden', marginRight: 8 },
  arc: { position: 'absolute', borderRadius: 12, borderWidth: 2.6, borderBottomColor: 'transparent', borderLeftColor: 'transparent', transform: [{ rotate: '-45deg' }] },
  battery: { width: 27, height: 14, borderWidth: 1.8, borderRadius: 4, padding: 1.5 },
  cap: { width: 2.5, height: 5, marginLeft: 1.5, borderTopRightRadius: 1.5, borderBottomRightRadius: 1.5 },
});
