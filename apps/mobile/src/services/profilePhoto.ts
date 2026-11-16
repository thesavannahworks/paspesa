import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { usePreference } from './preferences';

/**
 * Profile picture. Kept on this device only (it is not part of the simulated ledger):
 * - phone: copied into the app's document folder, the file URI is stored as a preference;
 * - web: stored as a small data URI (browser blob URLs do not survive a reload).
 */
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.5,
  base64: Platform.OS === 'web',
};

export type PhotoResult = { ok: true } | { ok: false; reason: 'cancelled' | 'denied' | 'failed' };

export function useProfilePhoto() {
  const [uri, setUri] = usePreference<string | null>('profilePhoto', null);

  const keep = async (asset: ImagePicker.ImagePickerAsset): Promise<PhotoResult> => {
    try {
      if (Platform.OS === 'web') {
        // The browser picker returns the picture as a data URL (sometimes also as base64).
        const data = asset.uri.startsWith('data:') ? asset.uri : asset.base64 ? `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}` : null;
        if (!data) return { ok: false, reason: 'failed' };
        setUri(data);
        return { ok: true };
      }
      const dir = new Directory(Paths.document, 'profile');
      if (!dir.exists) dir.create();
      const target = new File(dir, `photo-${Date.now()}.jpg`);
      await new File(asset.uri).copy(target);
      deleteFile(uri);
      setUri(target.uri);
      return { ok: true };
    } catch (e) {
      console.warn('[paspesa] profile photo not saved', e);
      return { ok: false, reason: 'failed' };
    }
  };

  const take = async (): Promise<PhotoResult> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    const res = await ImagePicker.launchCameraAsync({ ...OPTIONS, cameraType: ImagePicker.CameraType.front });
    if (res.canceled || !res.assets[0]) return { ok: false, reason: 'cancelled' };
    return keep(res.assets[0]);
  };

  const pick = async (): Promise<PhotoResult> => {
    const res = await ImagePicker.launchImageLibraryAsync(OPTIONS);
    if (res.canceled || !res.assets[0]) return { ok: false, reason: 'cancelled' };
    return keep(res.assets[0]);
  };

  const remove = () => {
    deleteFile(uri);
    setUri(null);
  };

  return { uri, take, pick, remove };
}

function deleteFile(uri: string | null) {
  if (!uri || Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // An old photo that cannot be removed is harmless.
  }
}
