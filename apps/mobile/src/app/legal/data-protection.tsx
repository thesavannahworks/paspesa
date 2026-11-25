import { Screen, ScreenHeader } from '@/components/ui';
import { MarkdownViewer } from '@/components/MarkdownViewer';

// Import markdown as string
const dataProtectionContent = require('../../../legal/data-protection.md') as string;

/**
 * Data Protection - loaded from markdown file
 */
export default function DataProtectionScreen() {
  return (
    <Screen background="page">
      <ScreenHeader title="Data Protection" />
      <MarkdownViewer content={dataProtectionContent} />
    </Screen>
  );
}
