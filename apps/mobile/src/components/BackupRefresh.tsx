/**
 * Pull down to refresh: backs up now (uploads what is waiting, fetches back-office settings and review
 * outcomes), then re-reads the screen's data. On web the browser has no pull gesture; the "Back up now"
 * button in Profile does the same.
 */
import { useCallback, useState } from 'react';
import { Platform, RefreshControl, type RefreshControlProps } from 'react-native';
import { useAppState } from '@/services/AppState';
import { syncNow } from '@/services/sync';
import { useTheme } from '@/theme/ThemeProvider';

export function useBackupRefresh() {
  const { refresh } = useAppState();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncNow();
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);
  return { refreshing, onRefresh };
}

/** Phones only: on the web the control breaks the scroll view's layout, and there is no pull gesture. */
export const backupRefreshControl = () => (Platform.OS === 'web' ? undefined : <BackupRefreshControl />);

/**
 * On Android the ScrollView clones this element and passes the scrolling content in as `children` (and
 * its layout `style`): both must reach the native RefreshControl, or the screen renders empty.
 */
function BackupRefreshControl(props: Partial<RefreshControlProps>) {
  const { colors } = useTheme();
  const { refreshing, onRefresh } = useBackupRefresh();
  return (
    <RefreshControl
      {...props}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      tintColor={colors.green}
      colors={[colors.green]}
      progressBackgroundColor={colors.surface}
    />
  );
}
