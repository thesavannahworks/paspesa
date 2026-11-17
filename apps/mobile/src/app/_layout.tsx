import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppLock } from '@/components/AppLock';
import { AppStateProvider, useAppState } from '@/services/AppState';
import { PreferencesProvider } from '@/services/preferences';
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

/** Starts background sync and refreshes the screens' data after each sync run. */
function SyncBridge({ runtime }: { runtime: Runtime }) {
  const { refresh } = useAppState();
  useEffect(() => {
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
            <ThemedStack />
            <AppLock />
            <SyncBridge runtime={runtime} />
          </AppStateProvider>
        </ThemeProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}
