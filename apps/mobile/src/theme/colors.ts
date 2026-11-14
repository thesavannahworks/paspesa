/**
 * Colour tokens sampled from the reference screenshots (reference-screenshots/).
 * Light and dark mirror each other token-for-token.
 */
export interface Palette {
  mode: 'light' | 'dark';
  /** Home/profile page background. */
  page: string;
  /** Journey screens (forms, confirm, PIN, success) background. */
  screen: string;
  header: string;
  surface: string;
  /** Icon circles, inner cards, segmented-track, chips. */
  raised: string;
  segmentTrack: string;
  paymentCard: string;
  paymentCardSelected: string;
  doMoreCard: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  inputBorder: string;
  inputBorderFocused: string;
  divider: string;
  green: string;
  greenTab: string;
  greenSoft: string;
  red: string;
  buttonDisabled: string;
  buttonDisabledText: string;
  overlay: string;
  /** Gradient used on card edges: cyan → green. */
  edgeGradient: [string, string];
}

const GREEN = '#36A839';
const RED = '#E92536';

export const dark: Palette = {
  mode: 'dark',
  page: '#121212',
  screen: '#121212',
  header: '#121212',
  surface: '#1E1E1E',
  raised: '#333333',
  segmentTrack: '#333333',
  paymentCard: '#2A2A2A',
  paymentCardSelected: '#2A2A2A',
  doMoreCard: '#242424',
  text: '#FFFFFF',
  textSecondary: '#A2A2A2',
  textMuted: '#7F8386',
  border: '#2C2C2C',
  inputBorder: '#48525C',
  inputBorderFocused: GREEN,
  divider: '#48525C',
  green: GREEN,
  greenTab: '#2DA043',
  greenSoft: '#0E3B1A',
  red: RED,
  buttonDisabled: '#333333',
  buttonDisabledText: '#9F9FA1',
  overlay: 'rgba(0,0,0,0.6)',
  edgeGradient: ['#27B9C8', '#1EEB2C'],
};

export const light: Palette = {
  mode: 'light',
  page: '#F2F3F7',
  screen: '#FFFFFF',
  header: '#FFFFFF',
  surface: '#FFFFFF',
  raised: '#F7F7F7',
  segmentTrack: '#F5F5F5',
  paymentCard: '#FFFFFF',
  paymentCardSelected: '#EAF7EE',
  doMoreCard: '#FFFFFF',
  text: '#222222',
  textSecondary: '#6B6B6B',
  textMuted: '#9A9A9A',
  border: '#E3E8EC',
  inputBorder: '#CDD2D8',
  inputBorderFocused: GREEN,
  divider: '#D5DCE2',
  green: GREEN,
  greenTab: GREEN,
  greenSoft: '#EBF6EE',
  red: RED,
  buttonDisabled: '#DDE1EE',
  buttonDisabledText: '#6E6E73',
  overlay: 'rgba(0,0,0,0.45)',
  edgeGradient: ['#27B9C8', '#1EEB2C'],
};

/** Avatar initials colour pairs (background, text) seen across the references. */
export const AVATAR_COLORS: Record<'light' | 'dark', [string, string][]> = {
  dark: [
    ['#0B3A1A', '#4CC36A'], ['#2A1B5E', '#9C8CF0'], ['#4A0F33', '#F06FB5'],
    ['#5A1A12', '#FF7A45'], ['#14215A', '#7F97FF'], ['#3D0D3D', '#E07CE0'],
  ],
  light: [
    ['#E8F7EC', '#2E9E4C'], ['#EFEAFE', '#6A4FD8'], ['#FDEBF5', '#C5268F'],
    ['#FFF0EA', '#D9531E'], ['#EAF1FF', '#3C62D6'], ['#F9EAF9', '#A23BA2'],
  ],
};
