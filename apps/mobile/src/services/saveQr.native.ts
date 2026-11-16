import { Asset, requestPermissionsAsync } from 'expo-media-library';
import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { SaveQrResult } from './saveQrTypes';

/** Saves a PNG of the My QR card to the phone's gallery. */
export async function saveQr(view: RefObject<ComponentRef<typeof View> | null>): Promise<SaveQrResult> {
  try {
    const perm = await requestPermissionsAsync(true);
    if (!perm.granted) return { ok: false, message: 'Allow access to your photos to save the QR code.' };
    const uri = await captureRef(view, { format: 'png', quality: 1 });
    await Asset.create(uri);
    return { ok: true, message: 'QR code saved to your gallery' };
  } catch (e) {
    console.warn('[paspesa] QR not saved', e);
    return { ok: false, message: 'The QR code could not be saved. Please try again.' };
  }
}
