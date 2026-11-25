import { Screen, ScreenHeader } from '@/components/ui';
import { MarkdownViewer } from '@/components/MarkdownViewer';

// Import the markdown content as a string
const aboutContent = require('../../legal/about.md');

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
