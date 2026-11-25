import { isValidEmail, normalizeEmail } from '@paspesa/core';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Checkbox } from '@/components/Checkbox';
import { Field, OutlineButton, PrimaryButton, Screen, T } from '@/components/ui';
import { useAppState } from '@/services/AppState';
import { messageOf, requestCode, useSession, verifyCode } from '@/services/session';
import { useTheme } from '@/theme/ThemeProvider';
import { s } from '@/theme/scale';

type Step = 'email' | 'code' | 'conflict';

/**
 * Sign in with email and a one-time code (first time on a device, or after signing out). Not based on a
 * reference screen. After this, the Paspesa PIN is used as before.
 */
export default function SignInScreen() {
  const { colors } = useTheme();
  const { refresh, account } = useAppState();
  const session = useSession();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [conflict, setConflict] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  if (!session.required || session.email) return <Redirect href="/" />;

  const send = async () => {
    const clean = normalizeEmail(email);
    if (!isValidEmail(clean)) return setError('Enter a valid email address');
    if (!agreedToTerms) return setError('You must accept the Privacy Policy, Terms of Service, and Data Protection notice to continue');
    setBusy(true);
    setError(null);
    try {
      const r = await requestCode(clean);
      setEmail(clean);
      setCode('');
      setResendIn(r.resendAfterSeconds);
      setInfo(`We sent a 6-digit code to ${clean}. It expires in 10 minutes.`);
      setStep('code');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (replaceLocal = false) => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email');
    setBusy(true);
    setError(null);
    try {
      const out = await verifyCode(email, code, replaceLocal);
      if (out.kind === 'CONFLICT') {
        setConflict(out.message);
        setStep('conflict');
        return;
      }
      await refresh();
      router.replace('/');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'conflict') {
    return (
      <Screen refreshable={false} footer={<PrimaryButton title={`Continue with ${email}`} onPress={() => void verify(true)} loading={busy} />}>
        <View style={{ paddingTop: s(32) }}>
          <T variant="amount" style={{ color: colors.green }}>Paspesa</T>
          <T variant="heading" style={{ marginTop: s(18) }}>Switch this device to {email}?</T>
          <T variant="body" color={colors.textSecondary} style={{ marginTop: s(10), lineHeight: s(22) }}>
            This device holds another account{account ? ` (${account.accountName})` : ''}. {conflict ?? ''}
            {'\n\n'}If you continue, that account is cleared from this device — it stays saved and comes back whenever its own email signs in — and this device continues with {email}.
          </T>
        </View>
        {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(14) }}>{error}</T> : null}
        <View style={{ marginTop: s(24) }}>
          <OutlineButton title="Use a different email" onPress={() => { setStep('email'); setError(null); setCode(''); }} />
        </View>
      </Screen>
    );
  }

  if (step === 'code') {
    return (
      <Screen refreshable={false} footer={<PrimaryButton title="Sign in" onPress={() => void verify()} loading={busy} disabled={code.length !== 6} />}>
        <View style={{ paddingTop: s(32) }}>
          <T variant="amount" style={{ color: colors.green }}>Paspesa</T>
          <T variant="heading" style={{ marginTop: s(18) }}>Enter the code</T>
          {info ? <T variant="body" color={colors.textSecondary} style={{ marginTop: s(10), lineHeight: s(22) }}>{info}</T> : null}
        </View>
        <Field
          label="6-digit code"
          value={code}
          onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); setError(null); }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          autoFocus
          placeholder="000000"
        />
        {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(14) }}>{error}</T> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: s(22) }}>
          <Pressable accessibilityRole="button" onPress={() => { setStep('email'); setError(null); }} hitSlop={8}>
            <T variant="label" color={colors.green}>Change email</T>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: resendIn > 0 || busy }} disabled={resendIn > 0 || busy} onPress={() => void send()} hitSlop={8}>
            <T variant="label" color={resendIn > 0 ? colors.textSecondary : colors.green}>{resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}</T>
          </Pressable>
        </View>
        <T variant="caption" color={colors.textSecondary} style={{ marginTop: s(22), lineHeight: s(19) }}>
          No email? Check your spam folder. The code comes from Paspesa and is only for signing in.
        </T>
      </Screen>
    );
  }

  return (
    <Screen refreshable={false} footer={<PrimaryButton title="Send code" onPress={() => void send()} loading={busy} />}>
      <View style={{ paddingTop: s(32) }}>
        <T variant="amount" style={{ color: colors.green }}>Paspesa</T>
        <T variant="heading" style={{ marginTop: s(18) }}>Sign in</T>
        <T variant="body" color={colors.textSecondary} style={{ marginTop: s(10), lineHeight: s(22) }}>
          Enter your email and we&apos;ll send you a code. Signing in keeps your simulated account backed up and lets you continue on another phone or on the web.
        </T>
      </View>
      {session.notice ? (
        <View style={{ marginTop: s(18), padding: s(14), borderRadius: s(10), backgroundColor: colors.greenSoft }}>
          <T variant="caption" color={colors.mode === 'dark' ? '#BFE8C8' : '#1F6B2B'} style={{ lineHeight: s(19) }}>{session.notice}</T>
        </View>
      ) : null}
      <Field
        label="Email"
        value={email}
        onChangeText={(v) => { setEmail(v); setError(null); }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        placeholder="you@example.com"
        onSubmitEditing={() => void send()}
        returnKeyType="send"
      />
      {error ? <T variant="caption" color={colors.red} style={{ marginTop: s(14) }}>{error}</T> : null}
      
      <View style={{ marginTop: s(20) }}>
        <Checkbox
          checked={agreedToTerms}
          onPress={() => setAgreedToTerms(!agreedToTerms)}
          label={
            <View>
              <T variant="body" color={colors.textSecondary} style={{ lineHeight: s(22), marginBottom: s(8) }}>
                I have read and agree to the following:
              </T>
              <Pressable onPress={() => router.push('/legal/privacy')} hitSlop={4}>
                <T variant="body" color={colors.green} style={{ textDecorationLine: 'underline', marginBottom: s(4) }}>
                  • Privacy Policy
                </T>
              </Pressable>
              <Pressable onPress={() => router.push('/legal/terms')} hitSlop={4}>
                <T variant="body" color={colors.green} style={{ textDecorationLine: 'underline', marginBottom: s(4) }}>
                  • Terms of Service
                </T>
              </Pressable>
              <Pressable onPress={() => router.push('/legal/data-protection')} hitSlop={4}>
                <T variant="body" color={colors.green} style={{ textDecorationLine: 'underline' }}>
                  • Data Protection Notice
                </T>
              </Pressable>
            </View>
          }
        />
      </View>
      
      <View style={{ marginTop: s(14), padding: s(14), borderRadius: s(10), backgroundColor: colors.raised }}>
        <T variant="caption" color={colors.textSecondary} style={{ lineHeight: s(19) }}>
          Paspesa is a simulator. It never asks for your real M-PESA PIN, and no real money moves.
        </T>
      </View>
    </Screen>
  );
}
