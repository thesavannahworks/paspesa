/**
 * Phone contact picker (reference-screenshots/11-contacts). Opened from the contact icon on the
 * Send Money, Pochi and Airtime (other number) phone fields.
 *
 * Privacy: contacts are read from the phone only while this screen is open. They are never stored,
 * synced or sent anywhere; only the picked number and name go into the form.
 * One row per phone number, as in the reference (a contact with two numbers appears twice).
 */
import { normalizeKenyanPhone, toLocalPhone } from '@paspesa/core';
import * as Contacts from 'expo-contacts/legacy';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Platform, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { AppModal as Modal } from './LayoutFrame';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, CircleButton, PrimaryButton, T, WEB_NO_OUTLINE } from '@/components/ui';
import { ChevronLeftIcon, SearchIcon } from '@/icons';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';

export interface PickedContact {
  name: string;
  /** Local form (07…/01…) when it is a Kenyan mobile number, otherwise as stored. */
  phone: string;
}

interface Row {
  key: string;
  name: string;
  number: string;
}

type Status = 'loading' | 'ready' | 'denied' | 'blocked' | 'unavailable';

export function ContactPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (c: PickedContact) => void }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {visible ? <ContactList onClose={onClose} onPick={onPick} /> : null}
    </Modal>
  );
}

function ContactList({ onClose, onPick }: { onClose: () => void; onPick: (c: PickedContact) => void }) {
  const { colors } = useTheme();
  const dark = colors.mode === 'dark';
  const [status, setStatus] = useState<Status>('loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      if (Platform.OS === 'web' || !(await Contacts.isAvailableAsync())) return 'unavailable' as const;
      const perm = await Contacts.requestPermissionsAsync();
      if (!perm.granted) return perm.canAskAgain ? ('denied' as const) : ('blocked' as const);
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });
      const list: Row[] = [];
      for (const c of data) {
        const name = (c.name ?? [c.firstName, c.lastName].filter(Boolean).join(' ')).trim();
        for (const [i, p] of (c.phoneNumbers ?? []).entries()) {
          if (p.number) list.push({ key: `${c.id}-${i}`, name: name || p.number, number: p.number });
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      if (live) setRows(list);
      return 'ready' as const;
    })()
      .then((st) => live && setStatus(st))
      .catch(() => live && setStatus('unavailable'));
    return () => {
      live = false;
    };
  }, [attempt]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, '');
    return rows.filter((r) => r.name.toLowerCase().includes(q) || (digits.length > 2 && r.number.replace(/\D/g, '').includes(digits)));
  }, [rows, query]);

  const pick = (r: Row) => {
    const normalized = normalizeKenyanPhone(r.number);
    onPick({ name: r.name, phone: normalized ? toLocalPhone(normalized) : r.number.replace(/[^\d+]/g, '') });
    onClose();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.screen }} edges={['top', 'bottom']}>
      {/* Measured on reference 11-contacts/01 (1.4 px per unit). */}
      <View style={styles.header}>
        <CircleButton label="Back" size={52} onPress={onClose}><ChevronLeftIcon color={colors.text} size={28} /></CircleButton>
        <T variant="title" style={styles.title}>Contacts</T>
      </View>
      <View style={[styles.search, { borderColor: dark ? '#3A4150' : '#D5DCE2' }]}>
        <SearchIcon size={24} color={colors.textSecondary} accent={colors.textSecondary} strokeWidth={1.4} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts"
          placeholderTextColor={colors.textSecondary}
          maxFontSizeMultiplier={FIXED_TEXT}
          accessibilityLabel="Search contacts"
          style={[{ flex: 1, color: colors.text, fontSize: s(18.3), marginLeft: s(10), paddingVertical: 0 }, WEB_NO_OUTLINE]}
        />
      </View>

      {status === 'ready' ? (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          contentContainerStyle={{ paddingHorizontal: s(21), paddingBottom: s(24) }}
          ListEmptyComponent={<T variant="body" color={colors.textSecondary} center style={{ marginTop: s(40) }}>{rows.length ? 'No matching contacts' : 'No contacts with phone numbers'}</T>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name} ${item.number}`}
              onPress={() => pick(item)}
              style={({ pressed }) => [styles.row, { borderBottomColor: dark ? '#2E2E2E' : '#ECECEC', opacity: pressed ? 0.6 : 1 }]}
            >
              <Avatar name={item.name} size={65} fontSize={18} />
              <View style={{ flex: 1, marginLeft: s(17) }}>
                <Text maxFontSizeMultiplier={FIXED_TEXT} numberOfLines={1} style={{ color: colors.text, fontSize: s(20), fontWeight: '500' }}>{item.name}</Text>
                <Text maxFontSizeMultiplier={FIXED_TEXT} numberOfLines={1} style={{ color: dark ? '#D2D2D2' : colors.textSecondary, fontSize: s(16.4), fontWeight: '500', marginTop: s(5) }}>{item.number}</Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <View style={{ paddingHorizontal: s(21), marginTop: s(60), alignItems: 'center' }}>
          <T variant="body" color={colors.textSecondary} center>
            {status === 'loading' ? 'Loading contacts…'
              : status === 'unavailable' ? 'Contacts are available in the Paspesa phone app.'
              : 'Allow access to your contacts to pick a recipient. Your contacts stay on this phone.'}
          </T>
          {status === 'denied' ? <PrimaryButton title="Allow Contacts" onPress={() => setAttempt((n) => n + 1)} style={{ marginTop: s(24), alignSelf: 'stretch' }} /> : null}
          {status === 'blocked' ? <PrimaryButton title="Open Settings" onPress={() => void Linking.openSettings()} style={{ marginTop: s(24), alignSelf: 'stretch' }} /> : null}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: s(21), paddingTop: s(21) },
  title: { flex: 1, textAlign: 'center', marginRight: s(52), fontSize: s(20.5), fontWeight: '500' },
  search: { flexDirection: 'row', alignItems: 'center', height: s(72), borderWidth: 1.4, borderRadius: s(9), marginHorizontal: s(21), marginTop: s(33), paddingHorizontal: s(23), marginBottom: s(4) },
  row: { flexDirection: 'row', alignItems: 'center', height: s(99), borderBottomWidth: 1.4 },
});
