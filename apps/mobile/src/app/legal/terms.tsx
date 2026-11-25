import { Screen, ScreenHeader } from '@/components/ui';
import { MarkdownViewer } from '@/components/MarkdownViewer';

// Import the markdown content as a string
const termsContent = require('../../../legal/terms-of-service.md');

/**
 * Terms of Service - loaded from markdown file
 */
export default function TermsOfServiceScreen() {
  return (
    <Screen background="page">
      <ScreenHeader title="Terms of Service" />
      <MarkdownViewer content={termsContent} />
    </Screen>
  );
}
