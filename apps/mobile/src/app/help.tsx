import { useLocalSearchParams } from 'expo-router';
import { DocumentScreen } from '@/components/MarkdownViewer';
import { DOCUMENTS } from '@/services/legal';

/** Shows the document from apps/mobile/legal (see services/legal.ts); `?section=` opens it at a heading. */
export default function HelpScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  return <DocumentScreen doc={DOCUMENTS.help} section={section ?? null} />;
}
