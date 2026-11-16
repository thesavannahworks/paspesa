import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import type { SaveQrResult } from './saveQrTypes';

/** Browser: downloads the QR code (the SVG inside the My QR card) as an image file. */
export async function saveQr(view: RefObject<ComponentRef<typeof View> | null>): Promise<SaveQrResult> {
  const el = view.current as unknown as HTMLElement | null;
  const svg = el?.querySelector('svg');
  if (!svg) return { ok: false, message: 'The QR code could not be saved.' };
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'paspesa-qr.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, message: 'QR code downloaded' };
}
