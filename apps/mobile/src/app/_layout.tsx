import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppLock } from '@/components/AppLock';
import { COLUMN_WIDTH, computeFrame, LayoutFrameProvider } from '@/components/LayoutFrame';
import { WebSidebar } from '@/components/WebSidebar';
import { AppStateProvider, useAppState } from '@/services/AppState';
import { PreferencesProvider, usePreference } from '@/services/preferences';
import { onWiped, useSession } from '@/services/session';
import { createRuntime, type Runtime } from '@/services/runtime';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

function ThemedStack() {
  const { colors } = useTheme();
  // The window behind the app (visible under the Android navigation bar) follows the theme.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.page);
  }, [colors.page]);
  return (
    <>
      <StatusBar style={colors.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.screen }, animation: 'slide_from_right' }} />
    </>
  );
}

/**
 * Phones: the screens fill the window. Web on a wide screen: a sidebar and the screens in a centred
 * column (see LayoutFrame). The same tree in both cases, so resizing the window keeps your place.
 */
function AppShell() {
  const { colors } = useTheme();
  const { account } = useAppState();
  const session = useSession();
  const { width } = useWindowDimensions();
  const sidebar = !!account && (!session.required || !!session.email);
  const frame = computeFrame(width, sidebar);
  return (
    <LayoutFrameProvider sidebar={sidebar}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: frame.wide ? colors.page : colors.screen }}>
        {frame.sidebar ? <WebSidebar /> : null}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View
            style={frame.wide
              ? { flex: 1, width: COLUMN_WIDTH, backgroundColor: colors.screen, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.divider }
              : { flex: 1, width: '100%' }}
          >
            <ThemedStack />
          </View>
        </View>
      </View>
      <AppLock />
    </LayoutFrameProvider>
  );
}

/** Starts background sync and refreshes the screens' data after each sync run. */
function SyncBridge({ runtime }: { runtime: Runtime }) {
  const { refresh } = useAppState();
  useEffect(() => {
    runtime.onConfigChange(() => void refresh());
    let wasRunning = false;
    const off = runtime.sync.subscribe((s) => {
      if (wasRunning && !s.running) void refresh();
      wasRunning = s.running;
    });
    runtime.sync.start();
    return off;
  }, [runtime, refresh]);
  return null;
}

/**
 * Signing out (here, or because the account moved to another device) wipes this device: clear the
 * person's preferences and go to the sign-in screen.
 */
function SessionBridge() {
  const { refresh } = useAppState();
  const session = useSession();
  const [, setPhoto] = usePreference<string | null>('profilePhoto', null);
  const [, setBiometrics] = usePreference('biometricsEnabled', false);
  const previous = useRef(session.email);
  useEffect(() => onWiped(() => { setPhoto(null); setBiometrics(false); }), [setPhoto, setBiometrics]);
  useEffect(() => {
    if (previous.current && !session.email) {
      // Leave every open screen first, then show the (now empty) ledger.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/sign-in');
      void refresh();
    }
    previous.current = session.email;
  }, [session.email, refresh]);
  return null;
}

export default function RootLayout() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createRuntime().then(setRuntime, (e: unknown) => {
      console.warn('[paspesa] start-up failed', e);
      setError('Paspesa could not open its local storage. Please restart the app.');
    });
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: s(24), backgroundColor: '#121212' }}>
        <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: '#FFFFFF', textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }
  if (!runtime) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212' }}>
        <ActivityIndicator color="#36A839" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <PreferencesProvider kv={runtime.kv} initial={runtime.initialPrefs}>
        <ThemeProvider>
          <AppStateProvider deps={runtime.deps}>
            <AppShell />
            <SyncBridge runtime={runtime} />
            <SessionBridge />
          </AppStateProvider>
        </ThemeProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}
