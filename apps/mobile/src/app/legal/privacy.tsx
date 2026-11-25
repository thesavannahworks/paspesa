import { Screen, ScreenHeader } from '@/components/ui';
import { MarkdownViewer } from '@/components/MarkdownViewer';

// Import the markdown content as a string
const privacyPolicyContent = require('../../../legal/privacy-policy.md');

/**
 * Privacy Policy - loaded from markdown file
 */
export default function PrivacyPolicyScreen() {
  return (
    <Screen background="page">
      <ScreenHeader title="Privacy Policy" />
      <MarkdownViewer content={privacyPolicyContent} />
    </Screen>
  );
}
