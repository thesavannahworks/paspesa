/**
 * The way back to the sign-in screen from the steps that follow a sign-in (set up an account, create this
 * device's PIN): a back arrow, the Android back button and "Signed in as … · Use a different email".
 * Going back signs this device out. Nothing is lost: on these steps nothing has been recorded on the device
 * yet, and an existing account stays on the server until its email signs in again.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, Platform, Pressable } from 'react-native';
import { T } from '@/components/ui';
import { signOut, useSession } from '@/services/session';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

export function useBackToSignIn() {
  const session = useSession();
  const [leaving, setLeaving] = useState(false);
  const available = session.required && !!session.email;
  const goBack = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    void signOut(true).finally(() => setLeaving(false)); // the app then shows the sign-in screen
  }, [leaving]);
  useFocusEffect(
    useCallback(() => {
      if (!available || Platform.OS !== 'android') return undefined; // the Android back button only
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack();
        return true;
      });
      return () => sub.remove();
    }, [available, goBack]),
  );
  return { available, goBack, leaving, email: session.email };
}

/** "Signed in as you@example.com · Use a different email". */
export function SignedInAs({ back }: { back: ReturnType<typeof useBackToSignIn> }) {
  const { colors } = useTheme();
  if (!back.available) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Use a different email" onPress={back.goBack} disabled={back.leaving} style={{ marginTop: s(12), alignSelf: 'flex-start' }}>
      <T variant="label" color={colors.textSecondary}>
        Signed in as {back.email} · <T variant="label" color={colors.green}>{back.leaving ? 'Signing out…' : 'Use a different email'}</T>
      </T>
    </Pressable>
  );
}
