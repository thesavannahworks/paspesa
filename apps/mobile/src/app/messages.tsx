/**
 * M-PESA messages thread (reference-screenshots/08-messages).
 *
 * - Bubbles oldest → newest, grouped by day; consecutive messages in the same minute share one time.
 * - Links and phone numbers are highlighted like the SMS app; a link opens the Paspesa home screen.
 * - Pinch (or Ctrl + scroll on the web) zooms the text; the zoom is remembered.
 * - Long press opens the message menu. The trash button selects several messages to delete.
 *   Deleting only removes messages from this screen: the M-PESA statement is never affected.
 * - Copy, share and forward send the message text exactly as shown.
 */
import {
  deleteMessages,
  localDateKey,
  markAllMessagesRead,
  setMessageStarred,
  toLocalParts,
  visibleMessages,
  type LocalParts,
  type MessageRecord,
} from '@paspesa/core';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { AppModal as Modal, useLayoutFrame } from '@/components/LayoutFrame';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Inert, Sheet, T } from '@/components/ui';
import { ArrowDownToLineIcon, CheckIcon, ChevronLeftIcon, CloseIcon, PersonFilledIcon, StarFilledIcon, TrashIcon } from '@/icons';
import { useAppState } from '@/services/AppState';
import { usePreference } from '@/services/preferences';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Body text size at zoom 1 (measured on reference 08-messages). */
const BODY_SIZE = 17.4;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 2.2;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

/** Copy, share and forward send the message exactly as shown (owner decision 2026-11-17). */
const shareable = (body: string) => body;

function palette(dark: boolean) {
  return dark
    ? { bg: '#000000', bubble: '#454545', text: '#F2F2F2', meta: '#A8A8A8', link: '#8AB4F8', menu: '#252525', fab: '#3D3D3D', pill: 'rgba(75,75,75,0.92)', check: '#3E8EF7', bar: '#1C1C1C' }
    : { bg: '#FFFFFF', bubble: '#EDEDED', text: '#111111', meta: '#6E6E6E', link: '#1A62D6', menu: '#FFFFFF', fab: '#E2E2E2', pill: 'rgba(220,220,220,0.95)', check: '#1A73E8', bar: '#F4F4F4' };
}
type Palette = ReturnType<typeof palette>;

const pad2 = (n: number) => String(n).padStart(2, '0');
const time24 = (p: LocalParts) => `${pad2(p.hour)}:${pad2(p.minute)}`;
const minuteKey = (p: LocalParts) => `${localDateKey(p)} ${time24(p)}`;

interface Row {
  message: MessageRecord;
  /** Day heading shown above this message. */
  heading: string | null;
  dayKey: string;
  pill: string;
  /** Last message of a same-minute cluster: shows the time. */
  showTime: boolean;
  /** First message of a cluster: wider gap above. */
  clusterStart: boolean;
  time: string;
}

function buildRows(messages: MessageRecord[], offset: number, nowYear: number): Row[] {
  const parts = messages.map((m) => toLocalParts(m.createdAt, offset));
  return messages.map((message, i) => {
    const p = parts[i]!;
    const prev = parts[i - 1];
    const next = parts[i + 1];
    const dayKey = localDateKey(p);
    const newDay = !prev || localDateKey(prev) !== dayKey;
    const weekday = DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
    return {
      message,
      dayKey,
      heading: newDay ? `${weekday}, ${p.day} ${MONTHS[p.month - 1]}${p.year !== nowYear ? ` ${p.year}` : ''}` : null,
      pill: `${p.day} ${MONTHS[p.month - 1]!.slice(0, 3)} ${p.year}`,
      showTime: !next || minuteKey(next) !== minuteKey(p),
      clusterStart: newDay || !prev || minuteKey(prev) !== minuteKey(p),
      time: time24(p),
    };
  });
}

export default function MessagesScreen() {
  const { colors } = useTheme();
  const pal = palette(colors.mode === 'dark');
  const { messages, deps, refresh } = useAppState();
  const offset = deps.config.utcOffsetMinutes;
  const { height } = useWindowDimensions();

  const [zoom, setZoom] = usePreference('messageZoom', 1);
  const [liveZoom, setLiveZoom] = useState<number | null>(null);
  const textZoom = liveZoom ?? zoom;

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ message: MessageRecord; x: number; y: number } | null>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [details, setDetails] = useState<MessageRecord | null>(null);
  const [selectText, setSelectText] = useState<MessageRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pill, setPill] = useState<string | null>(null);
  const [awayFromEnd, setAwayFromEnd] = useState(false);

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const atStart = useRef(true);
  const headingY = useRef(new Map<string, number>());
  const pillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (messages.some((m) => !m.readAt && !m.deletedAt)) void markAllMessagesRead(deps).then(refresh);
  }, [messages, deps, refresh]);

  useEffect(() => () => {
    if (pillTimer.current) clearTimeout(pillTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Web: Ctrl + wheel / trackpad pinch zooms the thread instead of the page.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(clampZoom(zoomRef.current * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  const thread = useMemo(() => visibleMessages(messages), [messages]);
  const rows = useMemo(() => buildRows(thread, offset, new Date().getFullYear()), [thread, offset]);

  const notify = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  // ---- pinch to zoom (two fingers anywhere on the thread)
  const onTouchMove = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length !== 2) return;
    const distance = Math.hypot(touches[0]!.pageX - touches[1]!.pageX, touches[0]!.pageY - touches[1]!.pageY);
    if (!pinch.current) {
      pinch.current = { distance, zoom: textZoom };
      return;
    }
    setLiveZoom(clampZoom((pinch.current.zoom * distance) / pinch.current.distance));
  };
  const onTouchEnd = () => {
    if (!pinch.current) return;
    pinch.current = null;
    if (liveZoom !== null) setZoom(liveZoom);
    setLiveZoom(null);
  };

  // ---- scrolling: open at the latest message, floating date pill, jump-to-latest button
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setAwayFromEnd(contentSize.height - contentOffset.y - layoutMeasurement.height > s(240));
    let current: string | null = null;
    for (const row of rows) {
      const y = headingY.current.get(row.dayKey);
      if (y !== undefined && y <= contentOffset.y + s(40)) current = row.pill;
    }
    if (current && contentOffset.y > s(20)) {
      setPill(current);
      if (pillTimer.current) clearTimeout(pillTimer.current);
      pillTimer.current = setTimeout(() => setPill(null), 1400);
    }
  };

  // ---- selection
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startSelecting = () => {
    setSelected(new Set());
    setSelecting(true);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const allSelected = thread.length > 0 && selected.size === thread.length;

  const runDelete = async (ids: string[]) => {
    const count = await deleteMessages(deps, ids);
    await refresh();
    setConfirmIds(null);
    stopSelecting();
    notify(count === 1 ? 'Message deleted' : `${count} messages deleted`);
  };

  // ---- menu actions
  const act = async (action: MenuAction, m: MessageRecord) => {
    setMenu(null);
    switch (action) {
      case 'delete':
        setConfirmIds([m.id]);
        break;
      case 'copy':
        await Clipboard.setStringAsync(shareable(m.body));
        notify('Copied to clipboard');
        break;
      case 'select':
        setSelectText(m);
        break;
      case 'forward':
        await forward(m.body, notify);
        break;
      case 'share':
        await share(m.body, notify);
        break;
      case 'star':
        await setMessageStarred(deps, m.id, !m.starred);
        await refresh();
        notify(m.starred ? 'Message unstarred' : 'Message starred');
        break;
      case 'details':
        setDetails(m);
        break;
    }
  };

  const fontSize = s(BODY_SIZE * textZoom);
  const lineHeight = s(BODY_SIZE * textZoom * 1.18);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: pal.bg }} edges={['top', 'bottom']}>
      {selecting ? (
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel selection" onPress={stopSelecting} hitSlop={12} style={styles.headerBack}>
            <CloseIcon size={24} color={pal.text} />
          </Pressable>
          <Text maxFontSizeMultiplier={FIXED_TEXT} style={[styles.title, { color: pal.text, flex: 1 }]}>
            {selected.size === 0 ? 'Select messages' : `${selected.size} selected`}
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Select all"
            accessibilityState={{ checked: allSelected }}
            onPress={() => setSelected(allSelected ? new Set() : new Set(thread.map((m) => m.id)))}
            style={{ alignItems: 'center' }}
          >
            <CheckCircle checked={allSelected} pal={pal} />
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.meta, fontSize: s(12), marginTop: s(2) }}>All</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12} style={styles.headerBack}>
            <ChevronLeftIcon size={30} color={pal.text} strokeWidth={1.5} />
          </Pressable>
          <View style={[styles.senderAvatar, { backgroundColor: pal.bubble }]}>
            <PersonFilledIcon size={30} />
          </View>
          <Text maxFontSizeMultiplier={FIXED_TEXT} style={[styles.title, { color: pal.text, flex: 1 }]}>MPESA</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete messages" onPress={startSelecting} hitSlop={12} disabled={thread.length === 0}>
            <TrashIcon size={32} color={pal.text} accent={pal.text} strokeWidth={1.5} />
          </Pressable>
        </View>
      )}


      <View style={{ flex: 1 }} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <ScrollView
          ref={scrollRef}
          scrollEnabled={liveZoom === null}
          onScroll={onScroll}
          scrollEventThrottle={32}
          onContentSizeChange={() => {
            if (atStart.current) scrollRef.current?.scrollToEnd({ animated: false });
          }}
          onScrollBeginDrag={() => {
            atStart.current = false;
          }}
          contentContainerStyle={{ paddingLeft: s(31), paddingRight: s(12), paddingBottom: s(28) }}
        >
          {rows.length === 0 ? (
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.meta, fontSize: s(16), textAlign: 'center', marginTop: s(80) }}>No messages yet.</Text>
          ) : null}
          {rows.map((row) => (
            <View key={row.message.id}>
              {row.heading ? (
                <View onLayout={(e) => headingY.current.set(row.dayKey, e.nativeEvent.layout.y)}>
                  <Text maxFontSizeMultiplier={FIXED_TEXT} style={[styles.dayHeading, { color: pal.meta }]}>{row.heading}</Text>
                </View>
              ) : null}
              <Bubble
                row={row}
                pal={pal}
                fontSize={fontSize}
                lineHeight={lineHeight}
                selecting={selecting}
                checked={selected.has(row.message.id)}
                onToggle={() => toggle(row.message.id)}
                onLongPress={(x, y) => setMenu({ message: row.message, x, y })}
              />
            </View>
          ))}
        </ScrollView>

        {pill ? (
          <View pointerEvents="none" style={[styles.pill, { backgroundColor: pal.pill }]}>
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.text, fontSize: s(16.5) }}>{pill}</Text>
          </View>
        ) : null}

        {awayFromEnd && !selecting ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Latest messages"
            onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
            style={[styles.fab, { backgroundColor: pal.fab }]}
          >
            <ArrowDownToLineIcon size={30} color={pal.text} strokeWidth={1.5} />
          </Pressable>
        ) : null}

        {toast ? (
          <View pointerEvents="none" style={[styles.toast, { backgroundColor: pal.pill }]}>
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.text, fontSize: s(15) }}>{toast}</Text>
          </View>
        ) : null}
      </View>

      {selecting ? (
        <View style={[styles.selectBar, { backgroundColor: pal.bar }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete selected messages"
            disabled={selected.size === 0}
            onPress={() => setConfirmIds([...selected])}
            style={{ alignItems: 'center', opacity: selected.size === 0 ? 0.4 : 1, paddingVertical: s(8), paddingHorizontal: s(30) }}
          >
            <TrashIcon size={26} color={pal.text} accent={pal.text} strokeWidth={1.5} />
            <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.text, fontSize: s(13), marginTop: s(2) }}>Delete</Text>
          </Pressable>
        </View>
      ) : null}

      <MessageMenu state={menu} pal={pal} screenHeight={height} onClose={() => setMenu(null)} onAction={act} />
      <ConfirmDelete count={confirmIds?.length ?? 0} visible={!!confirmIds} pal={pal} onCancel={() => setConfirmIds(null)} onConfirm={() => confirmIds && void runDelete(confirmIds)} />
      <DetailsSheet message={details} onClose={() => setDetails(null)} offset={offset} />
      <SelectTextSheet message={selectText} onClose={() => setSelectText(null)} />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------- bubble

/** URLs (without a trailing full stop) and runs of 7+ digits (phone, account numbers) look like links. */
const LINK_PATTERN = /(https?:\/\/[^\s]+?)(?=[.,]?(?:\s|$))|\b\d{7,}\b/g;

function BodyText({ body, pal, fontSize, lineHeight }: { body: string; pal: Palette; fontSize: number; lineHeight: number }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(body.slice(last, start));
    const text = match[0];
    const isUrl = text.startsWith('http');
    parts.push(
      <Text
        key={start}
        maxFontSizeMultiplier={FIXED_TEXT}
        accessibilityRole={isUrl ? 'link' : undefined}
        // Links in simulated messages lead back into Paspesa, never to an outside site.
        onPress={isUrl ? () => router.dismissTo('/') : undefined}
        style={{ color: pal.link, textDecorationLine: 'underline' }}
      >
        {text}
      </Text>,
    );
    last = start + text.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return (
    <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.text, fontSize, lineHeight }}>
      {parts}
    </Text>
  );
}

function Bubble({
  row, pal, fontSize, lineHeight, selecting, checked, onToggle, onLongPress,
}: {
  row: Row; pal: Palette; fontSize: number; lineHeight: number; selecting: boolean; checked: boolean;
  onToggle: () => void; onLongPress: (x: number, y: number) => void;
}) {
  const m = row.message;
  return (
    <Pressable
      accessibilityRole={selecting ? 'checkbox' : undefined}
      accessibilityState={selecting ? { checked } : undefined}
      accessibilityLabel={selecting ? `Select message: ${m.body.slice(0, 40)}` : undefined}
      onPress={selecting ? onToggle : undefined}
      onLongPress={selecting ? undefined : (e) => onLongPress(e.nativeEvent.pageX, e.nativeEvent.pageY)}
      delayLongPress={380}
      style={[styles.bubbleRow, { marginTop: row.heading ? 0 : row.clusterStart ? s(24) : s(6) }]}
    >
      {selecting ? <View style={{ marginLeft: -s(20), marginRight: s(10), alignSelf: 'center' }}><CheckCircle checked={checked} pal={pal} /></View> : null}
      <View testID="message-bubble" style={[styles.bubble, { backgroundColor: pal.bubble }]}>
        <BodyText body={m.body} pal={pal} fontSize={fontSize} lineHeight={lineHeight} />
      </View>
      <View style={styles.meta}>
        {m.starred ? <StarFilledIcon size={15} /> : null}
        {row.showTime ? <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.meta, fontSize: s(16) }}>{row.time}</Text> : null}
      </View>
    </Pressable>
  );
}

function CheckCircle({ checked, pal }: { checked: boolean; pal: Palette }) {
  return (
    <View style={[styles.check, checked ? { backgroundColor: pal.check, borderColor: pal.check } : { borderColor: pal.meta }]}>
      {checked ? <CheckIcon size={16} strokeWidth={2.4} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- long-press menu

type MenuAction = 'delete' | 'copy' | 'select' | 'forward' | 'share' | 'star' | 'details';

const MENU_WIDTH = 226;
const MENU_ITEM = 65;

function MessageMenu({
  state, pal, screenHeight, onClose, onAction,
}: {
  state: { message: MessageRecord; x: number; y: number } | null; pal: Palette; screenHeight: number;
  onClose: () => void; onAction: (a: MenuAction, m: MessageRecord) => void;
}) {
  const { contentWidth: width } = useLayoutFrame();
  if (!state) return null;
  const m = state.message;
  const items: { label: string; action?: MenuAction }[] = [
    { label: 'Delete', action: 'delete' },
    { label: 'Copy text', action: 'copy' },
    { label: 'Select text', action: 'select' },
    { label: 'Forward', action: 'forward' },
    { label: 'Share', action: 'share' },
    { label: m.starred ? 'Unstar message' : 'Star message', action: 'star' },
    // Undiscussed (Samsung Reminder integration): visible, not operational.
    { label: 'Add to reminder' },
    { label: 'View details', action: 'details' },
  ];
  const menuHeight = s(MENU_ITEM) * items.length + s(16);
  const left = Math.min(Math.max(state.x - s(MENU_WIDTH) * 0.35, s(16)), Math.min(width, 540) - s(MENU_WIDTH) - s(16));
  const top = Math.min(Math.max(state.y - s(24), s(24)), screenHeight - menuHeight - s(24));
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      <View accessibilityRole="menu" style={[styles.menu, { left, top, backgroundColor: pal.menu }]}>
        {items.map((item) =>
          item.action ? (
            <Pressable
              key={item.label}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              onPress={() => onAction(item.action!, m)}
              style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: 'rgba(128,128,128,0.18)' }]}
            >
              <Text maxFontSizeMultiplier={FIXED_TEXT} style={[styles.menuText, { color: pal.text }]}>{item.label}</Text>
            </Pressable>
          ) : (
            <Inert key={item.label} style={styles.menuItem}>
              <Text maxFontSizeMultiplier={FIXED_TEXT} style={[styles.menuText, { color: pal.text }]}>{item.label}</Text>
            </Inert>
          ),
        )}
      </View>
    </Modal>
  );
}

function ConfirmDelete({ visible, count, pal, onCancel, onConfirm }: { visible: boolean; count: number; pal: Palette; onCancel: () => void; onConfirm: () => void }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', padding: s(16) }]}>
        <View accessibilityRole="alert" style={[styles.dialog, { backgroundColor: pal.menu }]}>
          <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.text, fontSize: s(19), fontWeight: '500', textAlign: 'center' }}>
            {count === 1 ? 'Delete this message?' : `Delete ${count} messages?`}
          </Text>
          <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.meta, fontSize: s(15), textAlign: 'center', marginTop: s(10), lineHeight: s(21) }}>
            Messages are only removed from this screen. Your M-PESA statement is not affected.
          </Text>
          <View style={{ flexDirection: 'row', marginTop: s(22) }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={styles.dialogButton}>
              <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: pal.text, fontSize: s(17), fontWeight: '500' }}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Delete" onPress={onConfirm} style={styles.dialogButton}>
              <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.red, fontSize: s(17), fontWeight: '500' }}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DetailsSheet({ message, onClose, offset }: { message: MessageRecord | null; onClose: () => void; offset: number }) {
  const { colors } = useTheme();
  const { transactions } = useAppState();
  if (!message) return null;
  const p = toLocalParts(message.createdAt, offset);
  const tx = message.transactionId ? transactions.find((t) => t.id === message.transactionId) : undefined;
  const rows: [string, string][] = [
    ['Type', 'Text message'],
    ['From', 'MPESA'],
    ['Received', `${pad2(p.day)}/${pad2(p.month)}/${p.year} ${time24(p)}`],
    ...(tx ? ([['Transaction ID', tx.reference]] as [string, string][]) : []),
    ['Source', 'Generated by Paspesa (simulation)'],
  ];
  return (
    <Sheet visible title="Message details" onClose={onClose}>
      <View style={{ marginTop: s(16) }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ paddingVertical: s(10) }}>
            <T variant="caption" color={colors.textSecondary}>{label}</T>
            <T variant="body" style={{ marginTop: s(4) }}>{value}</T>
          </View>
        ))}
        {tx ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View transaction"
            onPress={() => {
              onClose();
              router.push({ pathname: '/statements/[id]', params: { id: tx.id } });
            }}
            style={{ paddingVertical: s(12) }}
          >
            <T variant="bodyStrong" color={colors.green}>View transaction</T>
          </Pressable>
        ) : null}
      </View>
    </Sheet>
  );
}

function SelectTextSheet({ message, onClose }: { message: MessageRecord | null; onClose: () => void }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <Sheet visible title="Select text" onClose={onClose}>
      <ScrollView style={{ maxHeight: s(420), marginTop: s(16) }}>
        <Text selectable maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.text, fontSize: s(17), lineHeight: s(24) }}>
          {shareable(message.body)}
        </Text>
      </ScrollView>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------- sharing

async function share(body: string, notify: (t: string) => void) {
  const message = shareable(body);
  try {
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: { text: string }) => Promise<void> }) : null;
      if (nav?.share) await nav.share({ text: message });
      else {
        await Clipboard.setStringAsync(message);
        notify('Sharing is not available here. Copied instead');
      }
      return;
    }
    await Share.share({ message });
  } catch {
    // dismissed
  }
}

/** Forward = a new SMS with the message text (falls back to the share sheet). */
async function forward(body: string, notify: (t: string) => void) {
  const url = `sms:${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(shareable(body))}`;
  try {
    if (Platform.OS !== 'web' && (await Linking.canOpenURL(url))) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // fall through to share
  }
  await share(body, notify);
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: s(26), paddingRight: s(17), paddingTop: s(21), height: s(105) },
  headerBack: { width: s(36), marginRight: s(10) },
  senderAvatar: { width: s(41), height: s(41), borderRadius: s(21), alignItems: 'center', justifyContent: 'center', marginRight: s(17) },
  title: { fontSize: s(27.4), fontWeight: '500' },
  dayHeading: { fontSize: s(15.5), textAlign: 'center', marginTop: s(30), marginBottom: s(28) },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end' },
  bubble: { maxWidth: s(340), flexShrink: 1, borderRadius: s(19), paddingHorizontal: s(15.5), paddingTop: s(9), paddingBottom: s(10) },
  meta: { width: s(58), marginLeft: s(5), paddingBottom: s(6), gap: s(2) },
  check: { width: s(24), height: s(24), borderRadius: s(12), borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', top: s(10), alignSelf: 'center', borderRadius: s(20), paddingHorizontal: s(16), paddingVertical: s(6) },
  fab: { position: 'absolute', right: s(26), bottom: s(10), width: s(52), height: s(52), borderRadius: s(26), alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', bottom: s(80), alignSelf: 'center', borderRadius: s(20), paddingHorizontal: s(18), paddingVertical: s(9) },
  selectBar: { alignItems: 'center', paddingTop: s(6), paddingBottom: s(6) },
  menu: {
    position: 'absolute', width: s(MENU_WIDTH), borderRadius: s(19), paddingVertical: s(8),
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12,
  },
  menuItem: { height: s(MENU_ITEM), justifyContent: 'center', paddingLeft: s(32) },
  menuText: { fontSize: s(19.5) },
  dialog: { borderRadius: s(24), padding: s(22), paddingBottom: s(10) },
  dialogButton: { flex: 1, alignItems: 'center', paddingVertical: s(12) },
});
