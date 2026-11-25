import { Screen, ScreenHeader } from '@/components/ui';
import { MarkdownViewer } from '@/components/MarkdownViewer';

// Import markdown as string
const privacyPolicyContent = require('../../../legal/privacy-policy.md') as string;

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
