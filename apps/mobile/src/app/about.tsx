import { Screen, ScreenHeader } from '@/components/ui';
import { MarkdownViewer } from '@/components/MarkdownViewer';

// Import markdown as string
const aboutContent = require('../../legal/about.md') as string;

/**
 * About App - loaded from markdown file
 */
export default function AboutAppScreen() {
  return (
    <Screen background="page">
      <ScreenHeader title="About Paspesa" />
      <MarkdownViewer content={aboutContent} />
    </Screen>
  );
}
