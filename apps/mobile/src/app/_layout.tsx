import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStateProvider } from '@/services/AppState';
import { PreferencesProvider } from '@/services/preferences';
import { createRuntime, type Runtime } from '@/services/runtime';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

function ThemedStack() {
  const { colors } = useTheme();
  return (
    <>
      <StatusBar style={colors.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.screen }, animation: 'slide_from_right' }} />
    </>
  );
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
        <Text style={{ color: '#FFFFFF', textAlign: 'center' }}>{error}</Text>
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
          </AppStateProvider>
        </ThemeProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}
