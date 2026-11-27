/**
 * Paspesa's documents (Privacy Policy, Terms, Data Protection notice, Help, About). The text lives in
 * `apps/mobile/legal/*.md` (one source for the app, the web app and the public HTML copies); each document
 * has an in-app route.
 *
 * LEGAL_VERSION: change it whenever the Privacy Policy, Terms or Data Protection notice change in substance.
 * The server records the version a person accepted at sign-in (proof of consent, Data Protection Act s.32).
 */
import type { Href } from 'expo-router';

export const LEGAL_VERSION = '2026-11-27';

export interface PaspesaDocument {
  /** Route in the app (and on the web app). */
  href: Href;
  title: string;
  /** The Markdown source, loaded as text by metro.transformer.js. */
  content: string;
}

/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads .md files as strings (metro.transformer.js) */
export const DOCUMENTS = {
  privacy: { href: '/legal/privacy', title: 'Privacy Policy', content: require('../../legal/privacy-policy.md') as string },
  terms: { href: '/legal/terms', title: 'Terms of Service', content: require('../../legal/terms-of-service.md') as string },
  dataProtection: { href: '/legal/data-protection', title: 'Data Protection Notice', content: require('../../legal/data-protection.md') as string },
  help: { href: '/help', title: 'Help & User Guide', content: require('../../legal/help.md') as string },
  about: { href: '/about', title: 'About Paspesa', content: require('../../legal/about.md') as string },
} satisfies Record<string, PaspesaDocument>;
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Where a link written in a document leads inside the app: another document by its file name
 * (`privacy-policy.md`, `terms-of-service.md#payments`) or its route (`/legal/terms`). Null = not ours.
 */
export function documentRoute(target: string): { href: Href; anchor: string | null } | null {
  const [path = '', anchor = null] = target.split('#') as [string, string | undefined];
  const file = path.replace(/^\.?\//, '').toLowerCase();
  const byFile: Record<string, Href> = {
    'privacy-policy.md': DOCUMENTS.privacy.href,
    'terms-of-service.md': DOCUMENTS.terms.href,
    'data-protection.md': DOCUMENTS.dataProtection.href,
    'help.md': DOCUMENTS.help.href,
    'about.md': DOCUMENTS.about.href,
    'legal/privacy': DOCUMENTS.privacy.href,
    'legal/terms': DOCUMENTS.terms.href,
    'legal/data-protection': DOCUMENTS.dataProtection.href,
    help: DOCUMENTS.help.href,
    about: DOCUMENTS.about.href,
  };
  const href = byFile[file];
  return href ? { href, anchor: anchor || null } : null;
}
