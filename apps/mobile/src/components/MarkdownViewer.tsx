/**
 * Shows one of Paspesa's documents (Markdown, see services/legal.ts) as a full screen: header, then the
 * document in the screen's only scroll view (a scroll view inside another misbehaves on Android).
 *
 * Links never go blindly to the phone's browser (that is what failed before):
 *  - `#section` (a table of contents) scrolls to the heading with that name on this page;
 *  - another document (`terms-of-service.md`, `/legal/terms`, optionally `#section`) opens it in the app;
 *  - `mailto:`, `tel:` and `https:` open the mail app, dialler or browser; if the phone cannot, it says so.
 */
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader, T } from '@/components/ui';
import { documentRoute, type PaspesaDocument } from '@/services/legal';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

/** The anchor a heading gets: lower case, letters/digits/spaces/hyphens kept, spaces become hyphens (as on GitHub). */
export const slugify = (text: string) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

const textOf = (node: ASTNode): string => (node.content ?? '') + (node.children ?? []).map(textOf).join('');

const PAD = 20;

/** A heading that reports where it is laid out (so `#section` links can scroll to it). */
function headingRule(level: 1 | 2 | 3 | 4, onHeading: (slug: string, y: number) => void) {
  return function renderHeading(node: ASTNode, children: ReactNode[], _parents: ASTNode[], styles: Record<string, object>) {
    const slug = slugify(textOf(node));
    return (
      <View key={node.key} style={styles[`_VIEW_SAFE_heading${level}`]} onLayout={(e) => onHeading(slug, e.nativeEvent.layout.y)}>
        {children}
      </View>
    );
  };
}

export function DocumentScreen({ doc, section }: { doc: PaspesaDocument; section?: string | null }) {
  const { colors } = useTheme();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const positions = useRef(new Map<string, number>());
  const [notice, setNotice] = useState<string | null>(null);

  const goTo = useCallback((anchor: string) => {
    const y = positions.current.get(slugify(decodeURIComponent(anchor)));
    if (y === undefined) {
      setNotice('That section was not found on this page.');
      return;
    }
    setNotice(null);
    scroll.current?.scrollTo({ y: Math.max(0, y + s(PAD) - s(8)), animated: true });
  }, []);

  const onLinkPress = useCallback((url: string): boolean => {
    setNotice(null);
    if (url.startsWith('#')) {
      goTo(url.slice(1));
      return false;
    }
    const route = documentRoute(url);
    if (route) {
      router.push(route.anchor ? ({ pathname: route.href as string, params: { section: route.anchor } } as never) : route.href);
      return false;
    }
    if (/^(https?:|mailto:|tel:)/i.test(url)) {
      if (Platform.OS === 'web') {
        window.open(url, url.startsWith('http') ? '_blank' : '_self', 'noopener');
      } else {
        Linking.openURL(url).catch(() => setNotice(url.startsWith('mailto:')
          ? `No email app is set up on this phone. Write to ${url.slice(7).split('?')[0]}.`
          : 'This link could not be opened on this phone.'));
      }
      return false;
    }
    setNotice('This link could not be opened.');
    return false;
  }, [goTo]);

  // Headings remember where they are, so `#section` links (and ?section= when opened from another page) work.
  const onHeading = useCallback((slug: string, y: number) => {
    positions.current.set(slug, y);
    if (section && slug === slugify(section)) scroll.current?.scrollTo({ y: y + s(PAD) - s(8), animated: false });
  }, [section]);
  // onHeading reads its refs only inside onLayout, after render; the rule objects themselves touch no ref.
  const rules = useMemo<RenderRules>(() => ({
    // eslint-disable-next-line react-hooks/refs
    heading1: headingRule(1, onHeading), heading2: headingRule(2, onHeading), heading3: headingRule(3, onHeading), heading4: headingRule(4, onHeading),
  }), [onHeading]);

  const md = StyleSheet.create({
    body: { color: colors.text, fontSize: s(16), lineHeight: s(24) },
    heading1: { color: colors.text, fontSize: s(26), lineHeight: s(32), fontWeight: '700', marginTop: s(8), marginBottom: s(12) },
    heading2: { color: colors.text, fontSize: s(21), lineHeight: s(28), fontWeight: '700', marginTop: s(26), marginBottom: s(10) },
    heading3: { color: colors.text, fontSize: s(18), lineHeight: s(25), fontWeight: '600', marginTop: s(18), marginBottom: s(8) },
    heading4: { color: colors.text, fontSize: s(16), lineHeight: s(23), fontWeight: '600', marginTop: s(14), marginBottom: s(6) },
    paragraph: { color: colors.textSecondary, fontSize: s(16), lineHeight: s(24), marginTop: 0, marginBottom: s(12) },
    strong: { color: colors.text, fontWeight: '600' },
    em: { fontStyle: 'italic' },
    link: { color: colors.green, textDecorationLine: 'underline' },
    bullet_list: { marginBottom: s(12) },
    ordered_list: { marginBottom: s(12) },
    list_item: { color: colors.textSecondary, fontSize: s(16), lineHeight: s(24), marginBottom: s(6) },
    bullet_list_icon: { color: colors.textSecondary, marginLeft: s(4), marginRight: s(8) },
    ordered_list_icon: { color: colors.textSecondary, marginLeft: s(4), marginRight: s(8) },
    code_inline: { backgroundColor: colors.raised, color: colors.text, borderRadius: s(4), fontSize: s(15) },
    blockquote: { backgroundColor: colors.raised, borderLeftColor: colors.green, borderLeftWidth: s(4), paddingHorizontal: s(12), paddingVertical: s(6), marginBottom: s(12) },
    hr: { backgroundColor: colors.divider, height: StyleSheet.hairlineWidth, marginVertical: s(18) },
    table: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, borderRadius: s(8), marginBottom: s(14) },
    thead: { backgroundColor: colors.raised },
    th: { color: colors.text, fontWeight: '600', padding: s(8) },
    tr: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
    td: { color: colors.textSecondary, padding: s(8) },
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.screen }} edges={['top', 'bottom']}>
      <View style={{ paddingHorizontal: s(21) }}>
        <ScreenHeader title={doc.title} />
      </View>
      {notice ? (
        <View style={[styles.notice, { backgroundColor: colors.raised }]}>
          <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.text, fontSize: s(14) }}>{notice}</Text>
        </View>
      ) : null}
      <ScrollView ref={scroll} contentContainerStyle={{ paddingHorizontal: s(PAD), paddingTop: s(PAD), paddingBottom: s(48) }}>
        <Markdown style={md} rules={rules} onLinkPress={onLinkPress}>{doc.content}</Markdown>
        <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(24) }}>
          Paspesa is a simulator: no real money moves in simulations, and Paspesa never asks for your real M-PESA PIN.
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  notice: { marginHorizontal: 16, marginTop: 4, padding: 10, borderRadius: 8 },
});
