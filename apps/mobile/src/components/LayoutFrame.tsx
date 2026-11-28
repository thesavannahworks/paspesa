/**
 * Web on a wide screen (a computer): instead of stretching phone screens across the window, the app is shown
 * inside a drawn phone — a Samsung Galaxy-style body with bezel, punch-hole camera, status bar and side keys.
 * The app inside is laid out at the owner's phone size (540 × 1141 dp, the size the screens are calibrated
 * for), and the whole phone is scaled evenly to fit the window's height. A sidebar for navigation sits
 * beside it. Phones, and narrow browser windows, are unchanged.
 *
 * Desktop view (a sidebar switch, owner 2026-11-18): instead of the phone, the home page is a full-width
 * dashboard and every other page is a centred card at the width the screens are designed for.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, useWindowDimensions, View, type ModalProps } from 'react-native';
import { REFERENCE_WIDTH } from '@/theme/scale';
import { useTheme } from '@/theme/ThemeProvider';

/** Web windows at least this wide show the app inside a phone… */
export const WIDE_MIN_WIDTH = 640;
/** …and from this width, with the sidebar. */
export const SIDEBAR_MIN_WIDTH = 1000;
export const SIDEBAR_WIDTH = 264;

/** The phone, in the app's own units (before the fit-to-window scale). */
export const PHONE = {
  screenWidth: REFERENCE_WIDTH,
  screenHeight: 1141,
  bezel: 15,
  statusBar: 38,
  bodyRadius: 72,
  /** Space kept around the phone in the window (window pixels). */
  margin: 28,
  /** Never drawn smaller than this. */
  minScale: 0.45,
} as const;
export const SCREEN_RADIUS = PHONE.bodyRadius - PHONE.bezel;

/** Desktop view: space around the content, the widest dashboard, the card's corner radius. */
export const DESKTOP = { margin: 28, maxWidth: 1180, radius: 16 } as const;
/** Which way the web app is shown on a computer (sidebar switch; remembered per browser). */
export type WebView = 'PHONE' | 'DESKTOP';
export const WEB_VIEW_KEY = 'webView';
export const PHONE_OUTER = { width: PHONE.screenWidth + 2 * PHONE.bezel, height: PHONE.screenHeight + 2 * PHONE.bezel };

export interface LayoutFrame {
  /** Web on a computer: inside the drawn phone, or the desktop view. */
  wide: boolean;
  /** 'phone' (drawn phone), 'desktop' (card or dashboard), 'none' (phones, narrow windows). */
  mode: 'phone' | 'desktop' | 'none';
  /** The sidebar is shown (wide, and signed in with an account). */
  sidebar: boolean;
  /** Size of the area the app's screens get, in app units (below the phone's status bar). */
  contentWidth: number;
  contentHeight: number;
  /** Where that area starts in the window (window pixels), and how much it is scaled. */
  columnLeft: number;
  contentTop: number;
  scale: number;
}

const FrameContext = createContext<LayoutFrame | null>(null);

/**
 * `desktop`: the desktop view was chosen (it needs the sidebar, so a wide enough window); `fullWidth`: the
 * page is the dashboard (uses the whole area instead of a card).
 */
export function computeFrame(width: number, height: number, sidebar: boolean, desktop = false, fullWidth = false): LayoutFrame {
  const wide = Platform.OS === 'web' && width >= WIDE_MIN_WIDTH;
  if (!wide) return { wide: false, mode: 'none', sidebar: false, contentWidth: width, contentHeight: height, columnLeft: 0, contentTop: 0, scale: 1 };
  const withSidebar = sidebar && width >= SIDEBAR_MIN_WIDTH;
  const side = withSidebar ? SIDEBAR_WIDTH : 0;
  if (desktop && withSidebar) {
    const room = width - side - 2 * DESKTOP.margin;
    const contentWidth = fullWidth ? Math.min(DESKTOP.maxWidth, room) : Math.min(PHONE.screenWidth, room);
    return {
      wide: true, mode: 'desktop', sidebar: true, contentWidth, contentHeight: height - 2 * DESKTOP.margin,
      columnLeft: side + (width - side - contentWidth) / 2, contentTop: DESKTOP.margin, scale: 1,
    };
  }
  const scale = Math.max(PHONE.minScale, Math.min(1, (height - 2 * PHONE.margin) / PHONE_OUTER.height, (width - side - 2 * PHONE.margin) / PHONE_OUTER.width));
  // The phone is centred in the area beside the sidebar and scaled about its centre.
  const centreX = side + (width - side) / 2;
  const centreY = height / 2;
  return {
    wide: true,
    mode: 'phone',
    sidebar: withSidebar,
    contentWidth: PHONE.screenWidth,
    contentHeight: PHONE.screenHeight - PHONE.statusBar,
    columnLeft: centreX - (scale * PHONE_OUTER.width) / 2 + scale * PHONE.bezel,
    contentTop: centreY - (scale * PHONE_OUTER.height) / 2 + scale * (PHONE.bezel + PHONE.statusBar),
    scale,
  };
}

export function LayoutFrameProvider({ sidebar, desktop, fullWidth, children }: { sidebar: boolean; desktop: boolean; fullWidth: boolean; children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const frame = useMemo(() => computeFrame(width, height, sidebar, desktop, fullWidth), [width, height, sidebar, desktop, fullWidth]);
  return <FrameContext.Provider value={frame}>{children}</FrameContext.Provider>;
}

export function useLayoutFrame(): LayoutFrame {
  const ctx = useContext(FrameContext);
  const { width, height } = useWindowDimensions();
  return ctx ?? { wide: false, mode: 'none', sidebar: false, contentWidth: width, contentHeight: height, columnLeft: 0, contentTop: 0, scale: 1 };
}

/** A touch's window position → the app's own coordinates (they differ inside the drawn phone). */
export function toAppPoint(frame: LayoutFrame, pageX: number, pageY: number): { x: number; y: number } {
  return { x: (pageX - frame.columnLeft) / frame.scale, y: (pageY - frame.contentTop) / frame.scale };
}

/**
 * Drop-in Modal: on a wide screen its content is placed over the phone's screen, at the same scale (bottom
 * sheets and dialogs stay inside the phone, under its status bar); the rest of the window stays as it is.
 */
export function AppModal({ children, transparent, ...props }: ModalProps) {
  const frame = useLayoutFrame();
  const { colors } = useTheme();
  // Phones: the window does not resize for the keyboard (edge-to-edge), so the content is lifted above it —
  // a bottom sheet's fields stay visible while typing.
  if (!frame.wide) {
    return (
      <Modal transparent={transparent} {...props}>
        {Platform.OS === 'web' ? children : <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>{children}</KeyboardAvoidingView>}
      </Modal>
    );
  }
  const w = frame.contentWidth;
  const h = frame.contentHeight;
  // Scaling happens about the box's centre: shift it so the scaled box lands on the phone's screen.
  return (
    <Modal transparent {...props}>
      <View
        style={{
          position: 'absolute',
          left: frame.columnLeft - (w * (1 - frame.scale)) / 2,
          top: frame.contentTop - (h * (1 - frame.scale)) / 2,
          width: w,
          height: h,
          transform: [{ scale: frame.scale }],
          overflow: 'hidden',
          ...(frame.mode === 'desktop'
            ? { borderRadius: DESKTOP.radius }
            : { borderBottomLeftRadius: SCREEN_RADIUS, borderBottomRightRadius: SCREEN_RADIUS }),
          backgroundColor: transparent ? 'transparent' : colors.screen,
        }}
      >
        {children}
      </View>
    </Modal>
  );
}
