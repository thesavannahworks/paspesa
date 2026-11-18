/**
 * Web on a wide screen (a computer): instead of stretching phone screens across the window, the app shows
 * a sidebar for navigation and the screens in a centred column at the width they are designed for.
 * Phones, and narrow browser windows, are unchanged.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Modal, Platform, useWindowDimensions, View, type ModalProps } from 'react-native';
import { REFERENCE_WIDTH } from '@/theme/scale';
import { useTheme } from '@/theme/ThemeProvider';

/** Web windows at least this wide show the screens in a centred column… */
export const WIDE_MIN_WIDTH = 640;
/** …and from this width, with the sidebar. */
export const SIDEBAR_MIN_WIDTH = 1000;
export const SIDEBAR_WIDTH = 264;
/** The screens are calibrated for this width (theme/scale). */
export const COLUMN_WIDTH = REFERENCE_WIDTH;

export interface LayoutFrame {
  /** Sidebar + centred column. */
  wide: boolean;
  /** The sidebar is shown (wide, and signed in with an account). */
  sidebar: boolean;
  /** Width available to a screen. */
  contentWidth: number;
  /** Left edge of the column in the window (for pop-ups placed over it). */
  columnLeft: number;
}

const FrameContext = createContext<LayoutFrame | null>(null);

export function computeFrame(width: number, sidebar: boolean): LayoutFrame {
  const wide = Platform.OS === 'web' && width >= WIDE_MIN_WIDTH;
  if (!wide) return { wide: false, sidebar: false, contentWidth: width, columnLeft: 0 };
  const withSidebar = sidebar && width >= SIDEBAR_MIN_WIDTH;
  const side = withSidebar ? SIDEBAR_WIDTH : 0;
  return { wide: true, sidebar: withSidebar, contentWidth: COLUMN_WIDTH, columnLeft: side + Math.max(0, (width - side - COLUMN_WIDTH) / 2) };
}

export function LayoutFrameProvider({ sidebar, children }: { sidebar: boolean; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const frame = useMemo(() => computeFrame(width, sidebar), [width, sidebar]);
  return <FrameContext.Provider value={frame}>{children}</FrameContext.Provider>;
}

export function useLayoutFrame(): LayoutFrame {
  const ctx = useContext(FrameContext);
  const { width } = useWindowDimensions();
  return ctx ?? { wide: false, sidebar: false, contentWidth: width, columnLeft: 0 };
}

/**
 * Drop-in Modal: on a wide screen its content is placed over the centred column (bottom sheets and
 * dialogs keep the phone width) and the rest of the window is dimmed or filled with the page colour.
 */
export function AppModal({ children, transparent, ...props }: ModalProps) {
  const frame = useLayoutFrame();
  const { colors } = useTheme();
  if (!frame.wide) return <Modal transparent={transparent} {...props}>{children}</Modal>;
  const side = transparent ? colors.overlay : colors.page;
  return (
    <Modal transparent {...props}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: frame.columnLeft, backgroundColor: side }} />
        <View style={{ width: frame.contentWidth, backgroundColor: transparent ? 'transparent' : colors.screen }}>{children}</View>
        <View style={{ flex: 1, backgroundColor: side }} />
      </View>
    </Modal>
  );
}
