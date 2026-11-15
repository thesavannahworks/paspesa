import { Dimensions, PixelRatio } from 'react-native';

/**
 * The reference app (reference-screenshots/) scales its whole layout with the screen width.
 * Our dimensions are calibrated so that at REFERENCE_WIDTH dp they match the screenshots;
 * on narrower phones everything shrinks proportionally, exactly like the reference.
 */
export const REFERENCE_WIDTH = 540;
const MIN_SCALE = 0.66;

const width = Math.min(Dimensions.get('window').width, REFERENCE_WIDTH);
export const UI_SCALE = Math.max(MIN_SCALE, width / REFERENCE_WIDTH);

/** Scale a reference-calibrated size (font size, spacing, radius, icon size) to this screen. */
export function s(n: number): number {
  return PixelRatio.roundToNearestPixel(n * UI_SCALE);
}

/**
 * Text keeps the reference size whatever the phone's system font-size setting, like the reference
 * app (measured: its text does not grow with the setting, ours grew 10% on the owner's phone).
 * Passed as `maxFontSizeMultiplier` to every Text/TextInput.
 */
export const FIXED_TEXT = 1;
