import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { usePreference } from '@/services/preferences';
import { dark, light, type Palette } from './colors';

export type ThemeChoice = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: Palette;
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [choice, setChoice] = usePreference<ThemeChoice>('theme', 'system');
  const value = useMemo<ThemeContextValue>(() => {
    const mode = choice === 'system' ? (system === 'light' ? 'light' : 'dark') : choice;
    return { colors: mode === 'dark' ? dark : light, choice, setChoice };
  }, [choice, system, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
