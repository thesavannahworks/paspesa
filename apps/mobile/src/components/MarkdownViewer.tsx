import { ScrollView, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

interface MarkdownViewerProps {
  content: string;
}

/**
 * Renders markdown content with app-consistent styling
 */
export function MarkdownViewer({ content }: MarkdownViewerProps) {
  const { colors } = useTheme();

  const markdownStyles = StyleSheet.create({
    body: {
      color: colors.text,
      fontSize: s(16),
      lineHeight: s(24),
    },
    heading1: {
      color: colors.text,
      fontSize: s(28),
      fontWeight: '700',
      marginTop: s(24),
      marginBottom: s(16),
    },
    heading2: {
      color: colors.text,
      fontSize: s(22),
      fontWeight: '600',
      marginTop: s(20),
      marginBottom: s(12),
    },
    heading3: {
      color: colors.text,
      fontSize: s(18),
      fontWeight: '600',
      marginTop: s(16),
      marginBottom: s(10),
    },
    paragraph: {
      color: colors.textSecondary,
      fontSize: s(16),
      lineHeight: s(24),
      marginBottom: s(12),
    },
    strong: {
      color: colors.text,
      fontWeight: '600',
    },
    em: {
      fontStyle: 'italic',
    },
    link: {
      color: colors.green,
      textDecorationLine: 'underline',
    },
    bullet_list: {
      marginBottom: s(12),
    },
    ordered_list: {
      marginBottom: s(12),
    },
    list_item: {
      color: colors.textSecondary,
      fontSize: s(16),
      lineHeight: s(24),
      marginBottom: s(6),
    },
    code_inline: {
      backgroundColor: colors.raised,
      color: colors.text,
      paddingHorizontal: s(6),
      paddingVertical: s(2),
      borderRadius: s(4),
      fontSize: s(15),
      fontFamily: 'monospace',
    },
    code_block: {
      backgroundColor: colors.raised,
      color: colors.text,
      padding: s(12),
      borderRadius: s(8),
      fontSize: s(14),
      fontFamily: 'monospace',
      marginBottom: s(12),
    },
    fence: {
      backgroundColor: colors.raised,
      color: colors.text,
      padding: s(12),
      borderRadius: s(8),
      fontSize: s(14),
      fontFamily: 'monospace',
      marginBottom: s(12),
    },
    blockquote: {
      backgroundColor: colors.raised,
      borderLeftColor: colors.green,
      borderLeftWidth: s(4),
      paddingLeft: s(12),
      paddingVertical: s(8),
      marginBottom: s(12),
    },
    hr: {
      backgroundColor: colors.border,
      height: s(1),
      marginVertical: s(20),
    },
    table: {
      borderWidth: s(1),
      borderColor: colors.border,
      borderRadius: s(8),
      marginBottom: s(12),
    },
    thead: {
      backgroundColor: colors.raised,
    },
    tbody: {},
    th: {
      color: colors.text,
      fontWeight: '600',
      padding: s(10),
      borderRightWidth: s(1),
      borderBottomWidth: s(1),
      borderColor: colors.border,
    },
    tr: {
      borderBottomWidth: s(1),
      borderColor: colors.border,
    },
    td: {
      color: colors.textSecondary,
      padding: s(10),
      borderRightWidth: s(1),
      borderColor: colors.border,
    },
  });

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: s(20), paddingBottom: s(40) }}
    >
      <Markdown style={markdownStyles}>{content}</Markdown>
    </ScrollView>
  );
}
