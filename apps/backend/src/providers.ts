/**
 * M-PESA STK Push providers, side by side so they can be compared (owner request 2026-11-17).
 * Each one is switched on by its own environment variables; several can be on at once. A purchase may
 * name the provider to use; otherwise PAYMENT_PROVIDER (or the first configured) is used.
 *
 * Every provider sends an STK prompt and is CONFIRMED by querying its API — a callback only triggers that
 * query and is never trusted on its own (White Paper §31).
 *
 * Built from each provider's public documentation (Nov 2026). Details the docs did not confirm are marked
 * "unverified" and can be overridden with *_BASE_URL while testing.
 *
 *   Daraja (Safaricom)  see mpesa.ts                     name: mpesa-daraja
 *   Kopo Kopo           KOPOKOPO_CLIENT_ID, KOPOKOPO_CLIENT_SECRET, KOPOKOPO_TILL, KOPOKOPO_CALLBACK_URL,
 *                       KOPOKOPO_ENV=sandbox|production, KOPOKOPO_BASE_URL     name: kopokopo
 *   IntaSend            INTASEND_SECRET_KEY, INTASEND_ENV=sandbox|production, INTASEND_BASE_URL   name: intasend
 *   Paystack            PAYSTACK_SECRET_KEY (sk_test_… / sk_live_…), PAYSTACK_EMAIL_DOMAIN       name: paystack
 *   PayHero             PAYHERO_API_USERNAME, PAYHERO_API_PASSWORD, PAYHERO_CHANNEL_ID, PAYHERO_CALLBACK_URL,
 *                       PAYHERO_BASE_URL                                                         name: payhero
 */
import type { PaymentRecord } from '@paspesa/core';
import type { PaymentProvider } from './monetization.service.js';
import { DarajaProvider, darajaConfigFromEnv } from './mpesa.js';

type Fetch = typeof fetch;
type Status = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

/** Optional: how to find our payment from a provider's callback body. */
export interface CallbackAware {
  callbackReference(body: unknown): { providerReference?: string; paymentId?: string } | null;
}

const local = (phone: string) => (phone.startsWith('254') ? `0${phone.slice(3)}` : phone);
const plus = (phone: string) => (phone.startsWith('+') ? phone : `+${phone}`);
const get = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

function needPhone(p: PaymentRecord): string {
  if (!p.payerPhone) throw new Error('No M-PESA number for this payment');
  return p.payerPhone;
}

// ------------------------------------------------------------------------------------------------ Kopo Kopo

export class KopoKopoProvider implements PaymentProvider, CallbackAware {
  readonly name = 'kopokopo';
  private token: { value: string; expiresAt: number } | null = null;
  constructor(
    private readonly cfg: { base: string; clientId: string; clientSecret: string; till: string; callbackUrl: string },
    private readonly http: Fetch = fetch,
  ) {}

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.http(`${this.cfg.base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'paspesa-backend' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: 'client_credentials' }).toString(),
    });
    const body = await readJson(res);
    const value = get(body, 'access_token');
    if (!res.ok || typeof value !== 'string') throw new Error(`Kopo Kopo authentication failed (${res.status})`);
    this.token = { value, expiresAt: Date.now() + Number(get(body, 'expires_in') ?? 3600) * 1000 };
    return value;
  }

  async initiate(p: PaymentRecord) {
    const res = await this.http(`${this.cfg.base}/api/v2/incoming_payments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        payment_channel: 'M-PESA STK Push',
        till_number: this.cfg.till,
        subscriber: { first_name: 'Paspesa', last_name: 'Customer', phone_number: plus(needPhone(p)) },
        amount: { currency: 'KES', value: String(p.amount) },
        metadata: { reference: p.id, notes: p.paymentType === 'TOKEN_PURCHASE' ? 'Paspesa tokens' : 'Paspesa simulation' },
        _links: { callback_url: this.cfg.callbackUrl },
      }),
    });
    const location = res.headers.get('location');
    if (res.status !== 201 || !location) throw new Error(`Kopo Kopo request failed (${res.status}): ${JSON.stringify(await readJson(res))}`);
    return { providerReference: location };
  }

  async checkStatus(location: string): Promise<Status> {
    if (!location.startsWith(this.cfg.base)) throw new Error('Unexpected Kopo Kopo reference');
    const res = await this.http(location, { headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Kopo Kopo status unavailable (${res.status})`);
    const status = String(get(await readJson(res), 'data', 'attributes', 'status') ?? '');
    return status === 'Success' ? 'SUCCESSFUL' : status === 'Failed' ? 'FAILED' : 'PENDING';
  }

  callbackReference(body: unknown) {
    const self = get(body, 'data', 'attributes', '_links', 'self');
    return typeof self === 'string' ? { providerReference: self } : null;
  }
}

// ------------------------------------------------------------------------------------------------ IntaSend

export class IntaSendProvider implements PaymentProvider, CallbackAware {
  readonly name = 'intasend';
  constructor(private readonly cfg: { base: string; secretKey: string }, private readonly http: Fetch = fetch) {}

  private post(path: string, body: unknown) {
    return this.http(`${this.cfg.base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.secretKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async initiate(p: PaymentRecord) {
    const res = await this.post('/payment/mpesa-stk-push/', { amount: p.amount, phone_number: needPhone(p), api_ref: p.id, narrative: p.paymentType === 'TOKEN_PURCHASE' ? 'Paspesa tokens' : 'Paspesa simulation' });
    const body = await readJson(res);
    const invoice = get(body, 'invoice', 'invoice_id');
    if (!res.ok || typeof invoice !== 'string') throw new Error(`IntaSend request failed (${res.status}): ${JSON.stringify(body)}`);
    return { providerReference: invoice };
  }

  /** unverified: status path and state names (COMPLETE / FAILED / PENDING / PROCESSING) from the SDK docs. */
  async checkStatus(invoiceId: string): Promise<Status> {
    const res = await this.post('/payment/status/', { invoice_id: invoiceId });
    if (!res.ok) throw new Error(`IntaSend status unavailable (${res.status})`);
    const state = String(get(await readJson(res), 'invoice', 'state') ?? '').toUpperCase();
    return state === 'COMPLETE' ? 'SUCCESSFUL' : state === 'FAILED' ? 'FAILED' : 'PENDING';
  }

  callbackReference(body: unknown) {
    const id = get(body, 'invoice_id');
    return typeof id === 'string' ? { providerReference: id } : null;
  }
}

// ------------------------------------------------------------------------------------------------ Paystack

export class PaystackProvider implements PaymentProvider, CallbackAware {
  readonly name = 'paystack';
  constructor(private readonly cfg: { secretKey: string; emailDomain: string; base: string }, private readonly http: Fetch = fetch) {}

  private headers() {
    return { authorization: `Bearer ${this.cfg.secretKey}`, 'content-type': 'application/json' };
  }

  async initiate(p: PaymentRecord) {
    const phone = needPhone(p);
    const reference = `paspesa_${p.id}`;
    const res = await this.http(`${this.cfg.base}/charge`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        // Paystack requires an email; Paspesa has none, so a stable per-number address is used.
        email: `${phone}@${this.cfg.emailDomain}`,
        amount: p.amount * 100, // subunits
        currency: 'KES',
        reference,
        mobile_money: { phone: plus(phone), provider: 'mpesa' },
      }),
    });
    const body = await readJson(res);
    if (!res.ok || get(body, 'status') !== true) throw new Error(`Paystack request failed (${res.status}): ${String(get(body, 'message') ?? '')}`);
    return { providerReference: String(get(body, 'data', 'reference') ?? reference) };
  }

  async checkStatus(reference: string): Promise<Status> {
    const res = await this.http(`${this.cfg.base}/transaction/verify/${encodeURIComponent(reference)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Paystack status unavailable (${res.status})`);
    const status = String(get(await readJson(res), 'data', 'status') ?? '');
    if (status === 'success') return 'SUCCESSFUL';
    if (status === 'failed' || status === 'abandoned' || status === 'reversed') return 'FAILED';
    return 'PENDING';
  }

  callbackReference(body: unknown) {
    const ref = get(body, 'data', 'reference');
    return typeof ref === 'string' ? { providerReference: ref } : null;
  }
}

// ------------------------------------------------------------------------------------------------ PayHero
// Checked against https://docs.payhero.co.ke/docs (2026-11-20): Basic auth (the dashboard's "Basic
// Authorization token", or API username + password); POST /payments → { success, status: QUEUED, reference,
// CheckoutRequestID }; GET /transaction-status?reference= → status QUEUED | SUCCESS | FAILED; callback body
// { response: { ExternalReference, CheckoutRequestID, ResultCode, Status: "Success" … }, status }.
// Abuse protection: more than 10 successive failed/cancelled prompts to one phone block that phone for 24 h;
// over 50 failures in 6 h restrict the account.

export class PayHeroProvider implements PaymentProvider, CallbackAware {
  readonly name = 'payhero';
  constructor(
    private readonly cfg: { base: string; basicToken: string; channelId: string; callbackUrl: string | null },
    private readonly http: Fetch = fetch,
  ) {}

  private headers() {
    return { authorization: `Basic ${this.cfg.basicToken}`, 'content-type': 'application/json' };
  }

  async initiate(p: PaymentRecord) {
    const res = await this.http(`${this.cfg.base}/payments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        amount: p.amount,
        phone_number: local(needPhone(p)),
        channel_id: Number(this.cfg.channelId),
        provider: 'm-pesa',
        external_reference: p.id,
        ...(this.cfg.callbackUrl ? { callback_url: this.cfg.callbackUrl } : {}),
      }),
    });
    const body = await readJson(res);
    const reference = get(body, 'reference') ?? get(body, 'CheckoutRequestID');
    if (!res.ok || typeof reference !== 'string') throw new Error(`PayHero request failed (${res.status}): ${JSON.stringify(body)}`);
    return { providerReference: reference };
  }

  /** QUEUED (no result yet) → PENDING; SUCCESS → SUCCESSFUL; FAILED → FAILED. */
  async checkStatus(reference: string): Promise<Status> {
    const res = await this.http(`${this.cfg.base}/transaction-status?reference=${encodeURIComponent(reference)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`PayHero status unavailable (${res.status})`);
    const status = String(get(await readJson(res), 'status') ?? '').toUpperCase();
    return status === 'SUCCESS' ? 'SUCCESSFUL' : status === 'FAILED' || status === 'CANCELLED' ? 'FAILED' : 'PENDING';
  }

  callbackReference(body: unknown) {
    const ext = get(body, 'response', 'ExternalReference') ?? get(body, 'external_reference');
    return typeof ext === 'string' ? { paymentId: ext } : null;
  }
}

// ------------------------------------------------------------------------------------------------ registry

export interface PaymentProviders {
  all: PaymentProvider[];
  byName(name: string): PaymentProvider | null;
  /** PAYMENT_PROVIDER, or the first configured. */
  default: PaymentProvider | null;
}

export function providerRegistry(list: PaymentProvider[], preferred?: string): PaymentProviders {
  const byName = (name: string) => list.find((p) => p.name === name) ?? null;
  return { all: list, byName, default: (preferred && byName(preferred)) || list[0] || null };
}

/** Every provider whose credentials are present in the environment. */
export function providersFromEnv(env: NodeJS.ProcessEnv): PaymentProviders {
  const list: PaymentProvider[] = [];
  const daraja = darajaConfigFromEnv(env);
  if (daraja) list.push(new DarajaProvider(daraja));
  if (env.KOPOKOPO_CLIENT_ID && env.KOPOKOPO_CLIENT_SECRET && env.KOPOKOPO_TILL && env.KOPOKOPO_CALLBACK_URL) {
    const base = env.KOPOKOPO_BASE_URL || (env.KOPOKOPO_ENV === 'production' ? 'https://api.kopokopo.com' : 'https://sandbox.kopokopo.com');
    list.push(new KopoKopoProvider({ base, clientId: env.KOPOKOPO_CLIENT_ID, clientSecret: env.KOPOKOPO_CLIENT_SECRET, till: env.KOPOKOPO_TILL, callbackUrl: env.KOPOKOPO_CALLBACK_URL }));
  }
  if (env.INTASEND_SECRET_KEY) {
    const base = env.INTASEND_BASE_URL || (env.INTASEND_ENV === 'production' ? 'https://payment.intasend.com/api/v1' : 'https://sandbox.intasend.com/api/v1');
    list.push(new IntaSendProvider({ base, secretKey: env.INTASEND_SECRET_KEY }));
  }
  if (env.PAYSTACK_SECRET_KEY) {
    list.push(new PaystackProvider({ secretKey: env.PAYSTACK_SECRET_KEY, emailDomain: env.PAYSTACK_EMAIL_DOMAIN || 'customers.paspesa.app', base: env.PAYSTACK_BASE_URL || 'https://api.paystack.co' }));
  }
  // The dashboard's ready-made token (PAYHERO_BASIC_TOKEN, with or without "Basic "), or username + password.
  const payheroToken = env.PAYHERO_BASIC_TOKEN?.trim().replace(/^Basic\s+/i, '')
    || (env.PAYHERO_API_USERNAME && env.PAYHERO_API_PASSWORD ? Buffer.from(`${env.PAYHERO_API_USERNAME}:${env.PAYHERO_API_PASSWORD}`).toString('base64') : '');
  if (payheroToken && env.PAYHERO_CHANNEL_ID) {
    list.push(new PayHeroProvider({ base: env.PAYHERO_BASE_URL || 'https://backend.payhero.co.ke/api/v2', basicToken: payheroToken, channelId: env.PAYHERO_CHANNEL_ID, callbackUrl: env.PAYHERO_CALLBACK_URL || null }));
  }
  return providerRegistry(list, env.PAYMENT_PROVIDER);
}
