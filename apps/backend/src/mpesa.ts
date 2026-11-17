/**
 * M-PESA STK Push through Safaricom Daraja (Lipa na M-PESA Online) — the payment provider for buying
 * tokens and pay-per-simulation (White Paper §31–33).
 *
 * Status is always confirmed with the STK Push Query API (never from a callback alone, §31), so this works
 * on a laptop without a public callback URL; the callback endpoint only speeds things up once hosted.
 *
 * Configuration (backend environment only — never in the app):
 *   MPESA_ENV               sandbox | production           (default sandbox)
 *   MPESA_CONSUMER_KEY      from the Daraja portal app
 *   MPESA_CONSUMER_SECRET   from the Daraja portal app
 *   MPESA_SHORTCODE         Business shortcode (sandbox: 174379)
 *   MPESA_PASSKEY           Lipa na M-PESA Online passkey (sandbox passkey is on the Daraja test page)
 *   MPESA_CALLBACK_URL      public HTTPS URL of POST /v1/payments/mpesa/callback (any HTTPS URL works for testing)
 *   MPESA_TRANSACTION_TYPE  CustomerPayBillOnline (Paybill, default) | CustomerBuyGoodsOnline (Till)
 *   MPESA_PARTY_B           Till number when using CustomerBuyGoodsOnline (defaults to the shortcode)
 */
import type { PaymentRecord } from '@paspesa/core';
import type { PaymentProvider } from './monetization.service.js';

export interface DarajaConfig {
  environment: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  passkey: string;
  callbackUrl: string;
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
  partyB: string;
  accountReference: string;
}

export function darajaConfigFromEnv(env: NodeJS.ProcessEnv): DarajaConfig | null {
  const { MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL } = env;
  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET || !MPESA_SHORTCODE || !MPESA_PASSKEY || !MPESA_CALLBACK_URL) return null;
  return {
    environment: env.MPESA_ENV === 'production' ? 'production' : 'sandbox',
    consumerKey: MPESA_CONSUMER_KEY,
    consumerSecret: MPESA_CONSUMER_SECRET,
    shortCode: MPESA_SHORTCODE,
    passkey: MPESA_PASSKEY,
    callbackUrl: MPESA_CALLBACK_URL,
    transactionType: env.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    partyB: env.MPESA_PARTY_B || MPESA_SHORTCODE,
    accountReference: 'Paspesa',
  };
}

type Fetch = typeof fetch;

/** Daraja answers the query with this error while the customer has not finished. */
const STILL_PROCESSING = '500.001.1001';

export class DarajaProvider implements PaymentProvider {
  readonly name = 'mpesa-daraja';
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: DarajaConfig,
    private readonly http: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get base() {
    return this.config.environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now().getTime() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
    const res = await this.http(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { authorization: `Basic ${basic}` } });
    if (!res.ok) throw new Error(`M-PESA authentication failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: string | number };
    this.token = { value: body.access_token, expiresAt: this.now().getTime() + Number(body.expires_in) * 1000 };
    return body.access_token;
  }

  /** Daraja timestamp (Kenya time, yyyyMMddHHmmss) and password = base64(shortcode + passkey + timestamp). */
  credentials(): { Timestamp: string; Password: string } {
    const eat = new Date(this.now().getTime() + 3 * 3_600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    const Timestamp = `${eat.getUTCFullYear()}${p(eat.getUTCMonth() + 1)}${p(eat.getUTCDate())}${p(eat.getUTCHours())}${p(eat.getUTCMinutes())}${p(eat.getUTCSeconds())}`;
    return { Timestamp, Password: Buffer.from(`${this.config.shortCode}${this.config.passkey}${Timestamp}`).toString('base64') };
  }

  private async post<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: T }> {
    const res = await this.http(`${this.base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T };
  }

  async initiate(payment: PaymentRecord): Promise<{ providerReference: string }> {
    if (!payment.payerPhone) throw new Error('No M-PESA number for this payment');
    const res = await this.post<{ ResponseCode?: string; CheckoutRequestID?: string; ResponseDescription?: string; errorMessage?: string }>('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: this.config.shortCode,
      ...this.credentials(),
      TransactionType: this.config.transactionType,
      Amount: payment.amount,
      PartyA: payment.payerPhone,
      PartyB: this.config.partyB,
      PhoneNumber: payment.payerPhone,
      CallBackURL: this.config.callbackUrl,
      AccountReference: this.config.accountReference,
      TransactionDesc: payment.paymentType === 'TOKEN_PURCHASE' ? 'Paspesa tokens' : 'Paspesa simulation',
    });
    if (!res.ok || res.body.ResponseCode !== '0' || !res.body.CheckoutRequestID) {
      throw new Error(res.body.errorMessage ?? res.body.ResponseDescription ?? `M-PESA request failed (${res.status})`);
    }
    return { providerReference: res.body.CheckoutRequestID };
  }

  async checkStatus(providerReference: string): Promise<'PENDING' | 'SUCCESSFUL' | 'FAILED'> {
    const res = await this.post<{ ResultCode?: string | number; errorCode?: string; errorMessage?: string }>('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: this.config.shortCode,
      ...this.credentials(),
      CheckoutRequestID: providerReference,
    });
    if (res.body.errorCode === STILL_PROCESSING) return 'PENDING';
    if (res.body.ResultCode === undefined) throw new Error(res.body.errorMessage ?? `M-PESA status unavailable (${res.status})`); // unknown ≠ failed
    // A ResultCode is final: 0 = paid; anything else = not paid (1032 cancelled, 2001 wrong PIN, 1 insufficient
    // funds, 1037 no response from the phone…). "Still waiting" comes back as errorCode 500.001.1001 above.
    return String(res.body.ResultCode) === '0' ? 'SUCCESSFUL' : 'FAILED';
  }
}
