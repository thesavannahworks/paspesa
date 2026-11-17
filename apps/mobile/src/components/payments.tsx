/**
 * Send Money / Pochi la Biashara / Buy Goods / Paybill journeys
 * (reference-screenshots/03-send-money, 04-pochi-la-biashara, 05-buy-goods, 06-paybill).
 *
 * One screen component drives every type: form → Confirm → PIN → Success, all through the core
 * engine (`quoteSimulation` for the confirm screen, `processSimulation` for the commit).
 * There is no real recipient/merchant lookup: names are typed by the user (White Paper §12.3) and
 * recalled from the user's own ledger when an identifier is reused.
 */
import {
  addFavourite,
  counterpartyKey,
  favouritesFor,
  formatAmount,
  formatConfirmTransactionCost,
  formatKsh,
  normalizeKenyanPhone,
  parseWholeShillings,
  processSimulation,
  quoteSimulation,
  recallNames,
  toLocalPhone,
  withdrawalChargeFor,
  type CounterpartyInput,
  type FavouriteSuggestion,
  type SimulationRequest,
  type SimulationType,
  type TransactionRecord,
} from '@paspesa/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  BillManagerIcon, ContactIcon, InvestIcon, MoneyMethodIcon, PlusIcon, PointsIcon, SharedPayIcon, ReceiptIcon, RequestMoneyIcon, ReverseIcon, ScanIcon,
  ScheduleIcon, SearchIcon, SendToManyIcon, StarFilledIcon, StarIcon,
} from '@/icons';
import { useAccount, useAppState } from '@/services/AppState';
import { usePreference } from '@/services/preferences';
import { useSubmission } from '@/services/useSubmission';
import { ContactPicker } from '@/components/ContactPicker';
import { PaySheet, type PaymentChoice } from '@/components/PaySheet';
import { usePayGate } from '@/services/payGate';
import { checkServerConfig } from '@/services/sync';
import { useTheme } from '@/theme/ThemeProvider';
import { FIXED_TEXT, s } from '@/theme/scale';
import { ConfirmView, PinView, ResultAction, SuccessView, authFields, type PinAuth } from './journey';
import { Avatar, Field, Inert, PrimaryButton, Screen, ScreenHeader, SegmentedTabs, T, WEB_NO_OUTLINE } from './ui';

export type PaymentType = Extract<SimulationType, 'SEND_MONEY' | 'POCHI' | 'BUY_GOODS' | 'PAYBILL'>;

interface FormState {
  phone: string;
  name: string;
  tillNumber: string;
  paybillNumber: string;
  businessName: string;
  accountReference: string;
  accountName: string;
  amount: string;
}

const EMPTY: FormState = { phone: '', name: '', tillNumber: '', paybillNumber: '', businessName: '', accountReference: '', accountName: '', amount: '' };

/** Which name fields the user typed themselves (recall never overwrites those). */
type Edited = Partial<Record<'name' | 'businessName' | 'accountName', boolean>>;

function counterpartyOf(type: PaymentType, f: FormState): CounterpartyInput {
  switch (type) {
    case 'SEND_MONEY':
    case 'POCHI':
      return { phone: f.phone, name: f.name };
    case 'BUY_GOODS':
      return { tillNumber: f.tillNumber, name: f.name };
    case 'PAYBILL':
      return { paybillNumber: f.paybillNumber, businessName: f.businessName, accountReference: f.accountReference, accountName: f.accountName };
  }
}

function requiredFilled(type: PaymentType, f: FormState): boolean {
  const filled = (v: string) => v.trim() !== '';
  if (!filled(f.amount)) return false;
  switch (type) {
    case 'SEND_MONEY':
    case 'POCHI':
      return filled(f.phone) && filled(f.name);
    case 'BUY_GOODS':
      return filled(f.tillNumber) && filled(f.name);
    case 'PAYBILL':
      return filled(f.paybillNumber) && filled(f.businessName) && filled(f.accountReference);
  }
}

const TAB_LABEL: Record<PaymentType, string> = {
  SEND_MONEY: 'Mobile number', POCHI: 'Pochi la Biashara', BUY_GOODS: 'Buy Goods', PAYBILL: 'Paybill',
};

// ---------------------------------------------------------------- screen

export function PaymentJourneyScreen({ title, types, lowercaseLabels }: { title: string; types: PaymentType[]; lowercaseLabels?: boolean }) {
  const { colors } = useTheme();
  const { deps, refresh, transactions, favourites } = useAppState();
  const account = useAccount();
  const submission = useSubmission();
  const params = useLocalSearchParams<Partial<Record<keyof FormState | 'tab', string>>>();

  const initialType = types.find((t) => t === params.tab) ?? types[0]!;
  const [type, setType] = useState<PaymentType>(initialType);
  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY,
    ...Object.fromEntries(Object.entries(params).filter(([k, v]) => k in EMPTY && typeof v === 'string')),
  }));
  const [edited, setEdited] = useState<Edited>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'form' | 'confirm' | 'pin' | 'success'>('form');
  const [pinError, setPinError] = useState<string | null>(null);
  const [result, setResult] = useState<TransactionRecord | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCharge, setAddCharge] = useState(false);
  const [balanceHidden] = usePreference('balanceHidden', false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payment, setPayment] = useState<PaymentChoice | null>(null);
  const payGate = usePayGate(deps);

  const favs = useMemo(
    () => favouritesFor([type], favourites, transactions, deps.config.frequentThreshold),
    [type, favourites, transactions, deps.config.frequentThreshold],
  );

  /** Update fields; when an identifier changes, re-offer names the user used for it before. */
  const update = (patch: Partial<FormState>, nameEdits: Edited = {}) => {
    const nextEdited = { ...edited, ...nameEdits };
    const next = { ...form, ...patch };
    const identifierChanged = ['phone', 'tillNumber', 'paybillNumber', 'accountReference'].some((k) => k in patch);
    if (identifierChanged) {
      const r = recallNames(type, next, transactions, favourites);
      if (!nextEdited.name && (type !== 'PAYBILL')) next.name = r.name ?? '';
      if (type === 'PAYBILL') {
        if (!nextEdited.businessName) next.businessName = r.businessName ?? '';
        if (!nextEdited.accountName) next.accountName = r.accountName ?? '';
      }
    }
    setForm(next);
    setEdited(nextEdited);
    setErrors({});
    setPayment(null);
    submission.reset();
  };

  const switchType = (t: PaymentType) => {
    setType(t);
    setAddCharge(false);
    setForm(EMPTY);
    setEdited({});
    setErrors({});
    submission.reset();
  };

  const pickFavourite = (f: FavouriteSuggestion) => {
    const c = f.counterparty;
    setForm({
      ...form,
      phone: c.phone ? toLocalPhone(c.phone) : '',
      name: c.name ?? '',
      tillNumber: c.tillNumber ?? '',
      paybillNumber: c.paybillNumber ?? '',
      businessName: c.businessName ?? '',
      accountReference: c.accountReference ?? '',
      accountName: c.accountName ?? '',
    });
    setEdited({});
    setErrors({});
    submission.reset();
  };

  const request = (): Omit<SimulationRequest, 'operationId'> | null => {
    const amount = parseWholeShillings(form.amount);
    if (amount === null) return null;
    const withCharge = type === 'SEND_MONEY' && addCharge && withdrawalChargeFor(deps.config, amount) !== null;
    return { type, amount, counterparty: counterpartyOf(type, form), ...(withCharge ? { addWithdrawalCharge: true } : {}) };
  };
  const req = request();
  // Payment (tokens / M-PESA) is settled on the pay sheet, so the form and confirm pages quote without it.
  const quote = req ? quoteSimulation(account, deps.config, req, { ignorePayment: true }) : null;

  const onContinue = () => {
    if (!quote) return setErrors({ amount: 'Enter an amount in whole shillings' });
    if (!quote.ok) return setErrors(quote.error.fieldErrors ?? { amount: quote.error.message });
    setStep('confirm');
  };

  const onPin = async (auth: PinAuth) => {
    if (!req) return;
    // Payments may have been switched on in the back office while this page was open.
    if (!payment) await checkServerConfig(2_000);
    const res = await submission.run((operationId) => processSimulation(deps, { ...req, operationId, ...authFields(auth), ...(payment ?? {}) }));
    if (!res.ok && res.error.code === 'PAYMENT_REQUIRED' && !payment) {
      setPinError(null);
      setStep('confirm');
      setPayOpen(true);
      return;
    }
    if (!res.ok) {
      setPinError(res.error.message);
      return;
    }
    setPinError(null);
    await refresh();
    setResult(res.transaction);
    setStep('success');
  };

  // ---- success
  if (step === 'success' && result) return <PaymentSuccess tx={result} />;

  // ---- PIN / confirm
  if ((step === 'pin' || step === 'confirm') && quote?.ok) {
    const q = quote.quote;
    const c = q.counterparty;
    const partyName = partyNameOf(type, c);
    if (step === 'pin') {
      return (
        <PinView
          badge={<Avatar name={partyName} size={79} fontSize={16.5} fontWeight="400" />}
          name={partyName}
          amount={q.amount}
          fee={q.fee}
          onSubmit={onPin}
          onBack={() => { setPinError(null); setStep('confirm'); }}
          error={pinError}
          busy={submission.busy}
        />
      );
    }
    const cost = { label: 'Transaction cost', value: formatConfirmTransactionCost(q.fee) };
    const amount = { label: 'Amount', value: formatKsh(q.amount) };
    const spec = {
      SEND_MONEY: {
        title: 'Send money to mobile number',
        action: 'Send',
        rows: [
          { label: 'Send to', value: c.name ?? '' },
          amount,
          ...(q.withdrawalCharge ? [{ label: 'Withdrawal charges included', value: formatKsh(q.withdrawalCharge) }] : []),
          cost,
        ],
      },
      POCHI: { title: 'Pay to Pochi La Biashara', action: 'Send', rows: [amount, { label: 'Send to', value: c.name ?? '' }, cost] },
      BUY_GOODS: { title: 'Pay to Buy Goods', action: 'Pay', rows: [{ label: 'Till Number:', value: c.tillNumber ?? '' }, { label: 'Pay to', value: c.name ?? '' }, amount, cost] },
      PAYBILL: {
        title: 'Pay to Paybill',
        action: 'Pay',
        rows: [
          { label: 'Paybill number', value: `${c.paybillNumber ?? ''} - ${c.businessName ?? ''}` },
          { label: 'Account number', value: c.accountReference ?? '' },
          ...(c.accountName ? [{ label: 'Account name', value: c.accountName.toUpperCase() }] : []),
          amount,
          cost,
        ],
      },
    }[type];
    const onConfirm = async () => {
      if (payment || !req) return setStep('pin');
      if (await payGate.needsPayment(account, req)) setPayOpen(true);
      else setStep('pin');
    };
    return (
      <>
        <ConfirmView
          badge={<Avatar name={type === 'PAYBILL' ? c.businessName ?? '' : partyName} size={64} fontSize={24} />}
          title={spec.title}
          rows={spec.rows}
          actionLabel={spec.action}
          onConfirm={() => void onConfirm()}
          busy={payGate.checking}
          onBack={() => setStep('form')}
        />
        <PaySheet
          visible={payOpen}
          tokenCost={q.pricing.tokenCost}
          simulation={{ operationId: submission.operationId(), type, amount: q.amount }}
          onClose={() => setPayOpen(false)}
          onChosen={(choice) => { setPayment(choice); setPayOpen(false); setStep('pin'); }}
        />
      </>
    );
  }

  // ---- form
  const L = (text: string) => (lowercaseLabels ? text.charAt(0) + text.slice(1).toLowerCase() : text);
  const phoneValid = !!normalizeKenyanPhone(form.phone);
  const canContinue = requiredFilled(type, form);

  return (
    <Screen>
      <ScreenHeader title={title} />
      <View style={{ marginTop: s(8) }}>
        <SegmentedTabs value={type} onChange={switchType} tabs={types.map((t) => ({ key: t, label: t === 'POCHI' && types.length > 2 ? 'Pochi la Biashara' : TAB_LABEL[t] }))} />
      </View>

      <FavouritesStrip items={favs} onPick={pickFavourite} onAdd={() => setAddOpen(true)} />
      <ContactPicker visible={contactsOpen} onClose={() => setContactsOpen(false)} onPick={(c) => update({ phone: c.phone, name: c.name }, { name: true })} />

      {type === 'SEND_MONEY' || type === 'POCHI' ? (
        <>
          <Field
            label="Enter Phone Number"
            placeholder="Enter Phone Number"
            value={form.phone}
            onChangeText={(v) => update({ phone: v })}
            keyboardType="phone-pad"
            error={errors.phone}
            right={
              <View style={styles.adornments}>
                <Pressable accessibilityRole="button" accessibilityLabel="Choose from contacts" hitSlop={8} onPress={() => setContactsOpen(true)}><ContactIcon size={30} /></Pressable>
                {type === 'SEND_MONEY' ? (
                  <>
                    <View style={[styles.adornDivider, { backgroundColor: colors.text }]} />
                    <Inert><ScanIcon size={30} /></Inert>
                  </>
                ) : null}
              </View>
            }
          />
          {phoneValid || errors.name ? (
            <NameLine
              value={form.name}
              onChange={(v) => update({ name: v }, { name: true })}
              placeholder={type === 'POCHI' ? 'Enter Pochi business name' : 'Enter recipient name'}
              error={errors.name}
            />
          ) : null}
        </>
      ) : null}

      {type === 'BUY_GOODS' ? (
        <>
          <Field
            label="Enter till number"
            placeholder="Enter till number"
            value={form.tillNumber}
            onChangeText={(v) => update({ tillNumber: v })}
            keyboardType="number-pad"
            error={errors.tillNumber}
            right={<Inert><ScanIcon size={30} /></Inert>}
          />
          {form.tillNumber.trim().length >= 5 || errors.name ? (
            <NameLine value={form.name} onChange={(v) => update({ name: v }, { name: true })} placeholder="Enter merchant name" error={errors.name} indent />
          ) : null}
        </>
      ) : null}

      {type === 'PAYBILL' ? (
        <>
          <Field
            label="Enter paybill"
            placeholder="Enter paybill"
            value={form.paybillNumber}
            onChangeText={(v) => update({ paybillNumber: v })}
            keyboardType="number-pad"
            error={errors.paybillNumber}
            right={
              <View style={styles.adornments}>
                <Inert><SearchIcon size={26} /></Inert>
                <View style={[styles.adornDivider, { backgroundColor: colors.inputBorder }]} />
                <Inert><ScanIcon size={30} /></Inert>
              </View>
            }
          />
          {form.paybillNumber.trim().length >= 5 || errors.businessName ? (
            <NameLine value={form.businessName} onChange={(v) => update({ businessName: v }, { businessName: true })} placeholder="Enter business name" error={errors.businessName} indent />
          ) : null}
          <Field
            label="Enter account number"
            placeholder="Enter account number"
            value={form.accountReference}
            onChangeText={(v) => update({ accountReference: v })}
            autoCapitalize="characters"
            error={errors.accountReference}
          />
          {form.accountReference.trim() !== '' ? (
            <NameLine value={form.accountName} onChange={(v) => update({ accountName: v }, { accountName: true })} placeholder="Account name (optional)" error={errors.accountName} indent />
          ) : null}
        </>
      ) : null}

      <Field
        label={L('Enter Amount')}
        placeholder="0"
        value={form.amount}
        onChangeText={(v) => update({ amount: v })}
        keyboardType="number-pad"
        error={errors.amount}
        right={<T variant="body">Ksh</T>}
      />
      {errors.amount ? null : balanceHidden ? (
        <View style={[styles.hiddenHint, { marginLeft: s(type === 'BUY_GOODS' || type === 'PAYBILL' ? 22 : 4), backgroundColor: colors.mode === 'dark' ? '#262626' : '#E6E8EC' }]} />
      ) : (
        <T variant="label" color={colors.textSecondary} style={{ marginTop: s(8), marginLeft: s(type === 'BUY_GOODS' || type === 'PAYBILL' ? 22 : 4), fontWeight: lowercaseLabels ? '600' : '400' }}>
          Balance: {formatKsh(account.currentBalanceCache)}{lowercaseLabels ? '  ' : ' '}- Fuliza: {formatKsh(0)}
        </T>
      )}

      {type === 'SEND_MONEY' ? (
        <WithdrawalChargeOption
          charge={(() => { const a = parseWholeShillings(form.amount); return a === null ? null : withdrawalChargeFor(deps.config, a); })()}
          checked={addCharge}
          onToggle={() => { setAddCharge(!addCharge); setErrors({}); submission.reset(); }}
        />
      ) : null}

      <PaymentMethods balance={account.currentBalanceCache} hidden={balanceHidden} three={type === 'BUY_GOODS' || type === 'PAYBILL'} />

      <PrimaryButton title="Continue" onPress={onContinue} disabled={!canContinue} style={{ marginTop: s(24) }} />

      <DoMore type={type} />

      <AddFavouriteSheet type={type} visible={addOpen} onClose={() => setAddOpen(false)} />
    </Screen>
  );
}

/**
 * Send Money option to also send the agent withdrawal charge (shown once the amount can be withdrawn,
 * i.e. from Ksh 50). No reference screen was supplied for this prompt; it follows the form's style.
 */
function WithdrawalChargeOption({ charge, checked, onToggle }: { charge: number | null; checked: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  if (charge === null) return null;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel="Add withdrawal charges"
      onPress={onToggle}
      hitSlop={6}
      style={styles.chargeRow}
    >
      <View style={[styles.checkbox, checked
        ? { borderColor: colors.green, backgroundColor: colors.mode === 'dark' ? '#1E3A23' : colors.greenSoft }
        : { borderColor: colors.mode === 'dark' ? '#4F5964' : '#C9CED4' }]}>
        {checked ? <Text maxFontSizeMultiplier={FIXED_TEXT} style={[styles.checkTick, { color: colors.green }]}>✓</Text> : null}
      </View>
      <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ marginLeft: s(14), fontSize: s(17), color: colors.green }}>
        Add withdrawal charges <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: colors.text }}>({formatKsh(charge)})</Text>
      </Text>
    </Pressable>
  );
}

function partyNameOf(type: PaymentType, c: { name?: string; businessName?: string; accountName?: string }): string {
  if (type === 'PAYBILL') return c.accountName || c.businessName || '';
  return c.name ?? '';
}

// ---------------------------------------------------------------- form pieces

/** The green name line under an identifier field (where the reference shows the looked-up name). */
/** Names are typed in Title Case by default (keyboard auto-capitalises words; caps lock still allowed). */
function NameLine({ value, onChange, placeholder, error, indent }: {
  value: string; onChange: (v: string) => void; placeholder: string; error?: string; indent?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: s(2), marginLeft: s(indent ? 22 : 4) }}>
      <TextInput maxFontSizeMultiplier={FIXED_TEXT}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mode === 'dark' ? '#2E6B33' : '#8CCB93'}
        autoCapitalize="words"
        accessibilityLabel={placeholder}
        style={[{ color: colors.green, fontSize: s(16), fontWeight: '500', paddingVertical: s(2) }, WEB_NO_OUTLINE]}
      />
      {error ? <T variant="caption" color={colors.red}>{error}</T> : null}
    </View>
  );
}

export function FavouritesStrip({ items, onPick, onAdd }: { items: FavouriteSuggestion[]; onPick: (f: FavouriteSuggestion) => void; onAdd: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: s(24) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T variant="heading" style={{ fontSize: s(21) }}>Favourites</T>
        <Inert><T variant="label" color={items.length ? colors.green : colors.text} style={{ fontSize: s(16) }}>View All</T></Inert>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: s(20), marginTop: s(16) }} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="Add favourite" onPress={onAdd} style={{ alignItems: 'center', width: s(64) }}>
          <View style={[styles.favCircle, { backgroundColor: colors.raised }]}><PlusIcon size={26} /></View>
          <T variant="label" color={colors.textSecondary} style={{ marginTop: s(8) }}>Add</T>
        </Pressable>
        {items.map((f) => (
          <Pressable key={f.key} accessibilityRole="button" accessibilityLabel={f.label} onPress={() => onPick(f)} style={{ alignItems: 'center', width: s(92) }}>
            <Avatar name={f.label} size={48} fontSize={18} />
            <T variant="label" center numberOfLines={2} style={{ marginTop: s(8) }}>{f.label}</T>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function PaymentMethods({ balance, hidden, three }: { balance: number; hidden: boolean; three: boolean }) {
  // With the balance hidden the reference shows a zero placeholder on the card (03-send-money/12).
  const shown = hidden ? '0.0' : formatAmount(balance);
  const { colors } = useTheme();
  const card = (selected: boolean, mark: ReactNode, title: string, sub: string) => (
    <View style={[three ? styles.methodTall : styles.methodWide, {
      borderColor: selected ? colors.green : colors.inputBorder,
      backgroundColor: selected ? colors.paymentCardSelected : colors.paymentCard,
    }]}>
      {selected ? <View style={[styles.corner, { borderTopColor: colors.green }]}><Text maxFontSizeMultiplier={FIXED_TEXT} style={styles.cornerTick}>✓</Text></View> : null}
      {mark}
      <View style={three ? { alignItems: 'center', marginTop: s(8) } : { marginLeft: s(14), flex: 1 }}>
        <T variant="body" style={{ fontSize: s(19), fontWeight: three ? '400' : '500' }} numberOfLines={1}>{title}</T>
        <T variant="label" color={colors.textSecondary} style={{ marginTop: s(4) }} numberOfLines={1}>{sub}</T>
      </View>
    </View>
  );
  return (
    <View style={{ marginTop: s(28) }}>
      <T variant="bodyStrong" style={{ fontSize: s(19) }}>Select Payment Method</T>
      <View style={{ flexDirection: 'row', gap: s(three ? 14 : 16), marginTop: s(16) }}>
        <View style={{ flex: 1 }} accessibilityRole="radio" accessibilityState={{ checked: true }}>
          {card(true, <MoneyMethodIcon size={30} />, 'M-PESA', three ? `Ksh. ${shown}` : `Bal. Ksh. ${shown}`)}
        </View>
        {three ? (
          <Inert style={{ flex: 1 }}>{card(false, <PointsIcon size={30} />, 'Bonga Points', 'Ksh. 0')}</Inert>
        ) : null}
        <Inert style={{ flex: 1 }}>{card(false, <SharedPayIcon size={30} />, 'Shiriki Pay', 'Select')}</Inert>
      </View>
    </View>
  );
}

function DoMore({ type }: { type: PaymentType }) {
  const { colors } = useTheme();
  const tiles: { icon: ReactNode; label: string }[] =
    type === 'SEND_MONEY'
      ? [
          { icon: <SendToManyIcon size={38} />, label: 'Send to\nMany' },
          { icon: <RequestMoneyIcon size={38} />, label: 'Request\nMoney' },
          { icon: <InvestIcon size={32} />, label: 'Invest to\nZiiDi' },
        ]
      : type === 'BUY_GOODS' || type === 'PAYBILL'
        ? [{ icon: <BillManagerIcon size={34} />, label: 'Bill Manager' }]
        : [];
  if (!tiles.length) return null;
  return (
    <View style={{ marginTop: s(36), marginBottom: s(12) }}>
      <T variant="bodyStrong" style={{ fontSize: s(19) }}>Do More</T>
      <View style={{ flexDirection: 'row', gap: s(16), marginTop: s(16) }}>
        {tiles.map((t) => (
          <Inert key={t.label} style={[styles.doMore, { backgroundColor: colors.doMoreCard, borderColor: colors.border }, tiles.length === 1 ? { width: '48%' } : { flex: 1 }]}>
            {tiles.length === 1 ? <View style={[styles.favCircle, { backgroundColor: colors.raised }]}>{t.icon}</View> : t.icon}
            <T variant="body" center style={{ marginTop: s(12), fontSize: s(19), lineHeight: s(27) }}>{t.label}</T>
          </Inert>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- add favourite

export function AddFavouriteSheet({ type, visible, onClose }: { type: PaymentType | 'AIRTIME'; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { deps, refresh } = useAppState();
  const [f, setF] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof FormState) => (v: string) => { setF({ ...f, [k]: v }); setErrors({}); };

  const close = () => { setF(EMPTY); setErrors({}); onClose(); };
  const save = async () => {
    const res = type === 'AIRTIME'
      ? await addFavourite(deps, { type, variant: 'OTHER', counterparty: { phone: f.phone }, label: f.name.trim() || f.phone.trim() })
      : await addFavourite(deps, { type, counterparty: counterpartyOf(type, f) });
    if (!res.ok) return setErrors(res.error.fieldErrors ?? { form: res.error.message });
    await refresh();
    close();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: colors.screen }]}>
        <T variant="title" center>Add to Favourites</T>
        <T variant="caption" color={colors.textSecondary} center style={{ marginTop: s(6) }}>{type === 'AIRTIME' ? 'Airtime Top Up' : TAB_LABEL[type] === 'Mobile number' ? 'Send Money' : TAB_LABEL[type]}</T>
        {type === 'AIRTIME' ? (
          <>
            <Field label="Phone number" placeholder="07XX XXX XXX" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={errors.phone} />
            <Field label="Name (optional)" value={f.name} onChangeText={set('name')} autoCapitalize="words" error={errors.name} />
          </>
        ) : type === 'SEND_MONEY' || type === 'POCHI' ? (
          <>
            <Field label="Phone number" placeholder="07XX XXX XXX" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={errors.phone} />
            <Field label={type === 'POCHI' ? 'Business name' : 'Name'} value={f.name} onChangeText={set('name')} autoCapitalize="words" error={errors.name} />
          </>
        ) : type === 'BUY_GOODS' ? (
          <>
            <Field label="Till number" value={f.tillNumber} onChangeText={set('tillNumber')} keyboardType="number-pad" error={errors.tillNumber} />
            <Field label="Merchant name" value={f.name} onChangeText={set('name')} autoCapitalize="words" error={errors.name} />
          </>
        ) : (
          <>
            <Field label="Paybill number" value={f.paybillNumber} onChangeText={set('paybillNumber')} keyboardType="number-pad" error={errors.paybillNumber} />
            <Field label="Business name" value={f.businessName} onChangeText={set('businessName')} autoCapitalize="words" error={errors.businessName} />
            <Field label="Account number" value={f.accountReference} onChangeText={set('accountReference')} autoCapitalize="characters" error={errors.accountReference} />
          </>
        )}
        {errors.form ? <T variant="caption" color={colors.red} style={{ marginTop: s(10) }}>{errors.form}</T> : null}
        <PrimaryButton title="Save" onPress={save} style={{ marginTop: s(22) }} />
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- success

function PaymentSuccess({ tx }: { tx: TransactionRecord }) {
  const { colors } = useTheme();
  const { favourites, deps, refresh } = useAppState();
  const type = tx.type as PaymentType;
  const c = tx.counterparty;
  const key = counterpartyKey(tx.type, tx.variant, c);
  const isFavourite = !!key && favourites.some((f) => f.type === tx.type && f.key === key);

  const favourite = async () => {
    if (isFavourite) return;
    await addFavourite(deps, { type, counterparty: c });
    await refresh();
  };

  const favAction = (
    <ResultAction
      icon={isFavourite ? <StarFilledIcon size={34} /> : <StarIcon size={34} />}
      label={isFavourite ? 'Added to\nfavourites' : 'Add to\nfavourites'}
      onPress={isFavourite ? undefined : favourite}
      inert={isFavourite}
    />
  );
  const schedule = <ResultAction icon={<ScheduleIcon size={34} />} label={'Schedule\npayment'} inert />;
  const receipt = <ResultAction icon={<ReceiptIcon size={34} />} label={'Download\nreceipt'} inert />;

  const partyName = partyNameOf(type, c);
  const lines =
    type === 'BUY_GOODS' ? [partyName.toUpperCase(), `Till number: ${c.tillNumber ?? ''}`]
    : type === 'PAYBILL' ? [partyName.toUpperCase(), `Paybill number: ${c.paybillNumber ?? ''}`, `Account number: ${c.accountReference ?? ''}`]
    : [partyName.toUpperCase(), `Phone number:${toLocalPhone(c.phone ?? '')}`];

  const actions =
    type === 'SEND_MONEY' ? <>{favAction}<ResultAction icon={<ReverseIcon size={34} />} label={'Reverse\ntransaction'} inert />{schedule}{receipt}</>
    : type === 'POCHI' ? <>{favAction}{receipt}</>
    : <>{favAction}{schedule}{receipt}</>;

  return (
    <SuccessView
      transaction={tx}
      partyLabel={type === 'SEND_MONEY' || type === 'POCHI' ? 'Send to:' : 'Paid to:'}
      partyBadge={<Avatar name={partyName} size={56} />}
      partyLines={lines}
      actions={actions}
      onDone={() => router.dismissTo('/')}
      banner={type === 'SEND_MONEY' || type === 'PAYBILL' ? <ZiidiBanner /> : null}
      cardFooter={type === 'BUY_GOODS' ? (
        <Inert style={{ alignSelf: 'stretch', marginTop: s(26) }}>
          <T variant="body" style={{ fontSize: s(18) }}>Liked our Service?</T>
          <View style={[styles.tipButton, { borderColor: colors.green }]}>
            <T variant="body" color={colors.green} style={{ fontSize: s(18) }}>Add Tip</T>
          </View>
        </Inert>
      ) : null}
    />
  );
}

/** Reference element kept visible but inert (owner rule); partner logo replaced by a placeholder. */
function ZiidiBanner() {
  const { colors } = useTheme();
  return (
    <Inert style={[styles.banner, { borderColor: colors.green }]}>
      <InvestIcon size={62} />
      <T variant="body" style={{ flex: 1, marginLeft: s(14), fontSize: s(19) }}>ZiiDi Autoinvest is active</T>
      <View style={[styles.bannerButton, { backgroundColor: colors.green }]}>
        <Text maxFontSizeMultiplier={FIXED_TEXT} style={{ color: '#FFFFFF', fontSize: s(19), fontWeight: '600' }}>Edit Settings</Text>
      </View>
    </Inert>
  );
}

const styles = StyleSheet.create({
  chargeRow: { flexDirection: 'row', alignItems: 'center', marginTop: s(26) },
  checkbox: { width: s(30), height: s(30), borderRadius: s(8), borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  checkTick: { fontSize: s(17), fontWeight: '600' },
  hiddenHint: { width: s(260), height: s(18), borderRadius: s(9), marginTop: s(10) },
  adornments: { flexDirection: 'row', alignItems: 'center', gap: s(14) },
  adornDivider: { width: 1.5, height: s(30) },
  favCircle: { width: s(48), height: s(48), borderRadius: s(24), alignItems: 'center', justifyContent: 'center' },
  methodWide: { borderWidth: 1.4, borderRadius: s(10), paddingHorizontal: s(14), paddingVertical: s(14), flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  methodTall: { borderWidth: 1.4, borderRadius: s(10), paddingVertical: s(14), alignItems: 'center', overflow: 'hidden' },
  corner: {
    position: 'absolute', top: 0, right: 0, width: 0, height: 0,
    borderTopWidth: s(30), borderLeftWidth: s(30), borderLeftColor: 'transparent',
  },
  cornerTick: { position: 'absolute', top: -s(29), left: -s(15), color: '#FFFFFF', fontSize: s(11), fontWeight: '700' },
  doMore: { borderRadius: s(16), borderWidth: StyleSheet.hairlineWidth, paddingVertical: s(22), alignItems: 'center', justifyContent: 'center', minHeight: s(150) },
  sheet: { borderTopLeftRadius: s(24), borderTopRightRadius: s(24), padding: s(20), paddingBottom: s(30) },
  tipButton: { alignSelf: 'flex-start', borderWidth: 1.4, borderRadius: s(8), paddingHorizontal: s(14), paddingVertical: s(6), marginTop: s(16) },
  banner: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderRadius: s(12), padding: s(16), marginTop: s(24) },
  bannerButton: { borderRadius: s(8), paddingHorizontal: s(18), paddingVertical: s(12) },
});
