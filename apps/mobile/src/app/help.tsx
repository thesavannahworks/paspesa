import { Screen, ScreenHeader } from '@/components/ui';
import { MarkdownViewer } from '@/components/MarkdownViewer';

// Import markdown as string
const helpContent = require('../../legal/help.md') as string;

/**
 * Help & User Guide - loaded from markdown file
 */
export default function HelpScreen() {
  return (
    <Screen background="page">
      <ScreenHeader title="Help & User Guide" />
      <MarkdownViewer content={helpContent} />
    </Screen>
  );
}
