/**
 * M-PESA STK Push adapter (Daraja) against a stand-in for Safaricom's API, plus the payment endpoints
 * end to end with a stand-in provider. No real money and no network.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentRecord } from '@paspesa/core';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/database.js';
import type { PaymentProvider } from '../src/monetization.service.js';
import { DarajaProvider, darajaConfigFromEnv, type DarajaConfig } from '../src/mpesa.js';

const config: DarajaConfig = {
  environment: 'sandbox', consumerKey: 'key', consumerSecret: 'secret', shortCode: '174379', passkey: 'passkey',
  callbackUrl: 'https://example.com/cb', transactionType: 'CustomerPayBillOnline', partyB: '174379', accountReference: 'Paspesa',
};

function fakeDaraja(queryAnswers: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null; auth: string | null }> = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get('authorization') });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/oauth/v1/generate')) return json(200, { access_token: 'tok-1', expires_in: '3599' });
    if (url.endsWith('/mpesa/stkpush/v1/processrequest')) return json(200, { ResponseCode: '0', CheckoutRequestID: 'ws_CO_123', ResponseDescription: 'Success. Request accepted for processing' });
    if (url.endsWith('/mpesa/stkpushquery/v1/query')) {
      const a = queryAnswers.shift()!;
      return json(a.status, a.body);
    }
    return json(404, {});
  }) as typeof fetch;
  return { http, calls };
}

const payment = (patch: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'p1', ownerId: 'a1', paymentType: 'TOKEN_PURCHASE', provider: 'mpesa-daraja', providerReference: null, idempotencyKey: 'k', amount: 150, currency: 'KES',
  status: 'INITIATED', tokens: 150, payerPhone: '254759981287', relatedSimulationId: null, simulationStatus: 'NOT_APPLICABLE', refundStatus: 'NONE',
  createdAt: '2026-11-17T09:00:00Z', verifiedAt: null, ...patch,
});

describe('Daraja STK Push adapter', () => {
  it('reads its configuration from the environment only when complete', () => {
    expect(darajaConfigFromEnv({})).toBeNull();
    expect(darajaConfigFromEnv({ MPESA_CONSUMER_KEY: 'k', MPESA_CONSUMER_SECRET: 's', MPESA_SHORTCODE: '174379', MPESA_PASSKEY: 'p', MPESA_CALLBACK_URL: 'https://x/cb' }))
      .toMatchObject({ environment: 'sandbox', transactionType: 'CustomerPayBillOnline', partyB: '174379' });
  });

  it('sends the STK request Daraja expects (password, Kenya-time timestamp, phone, amount) and reuses the token', async () => {
    const { http, calls } = fakeDaraja([]);
    const now = () => new Date('2026-11-17T06:05:09Z'); // 09:05:09 in Nairobi
    const mpesa = new DarajaProvider(config, http, now);
    expect(mpesa.credentials()).toEqual({ Timestamp: '20261117090509', Password: Buffer.from('174379passkey20261117090509').toString('base64') });
    expect(await mpesa.initiate(payment())).toEqual({ providerReference: 'ws_CO_123' });
    await mpesa.initiate(payment({ id: 'p2' }));
    const stk = calls.filter((c) => c.url.endsWith('processrequest'));
    expect(stk[0]!.body).toMatchObject({
      BusinessShortCode: '174379', Timestamp: '20261117090509', TransactionType: 'CustomerPayBillOnline', Amount: 150,
      PartyA: '254759981287', PartyB: '174379', PhoneNumber: '254759981287', CallBackURL: 'https://example.com/cb', AccountReference: 'Paspesa',
    });
    expect(stk[0]!.auth).toBe('Bearer tok-1');
    expect(calls.filter((c) => c.url.includes('oauth')).length).toBe(1); // token cached
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
  });

  it('maps STK query answers: processing → PENDING, 0 → SUCCESSFUL, 1032 (cancelled) → FAILED, outage → error (not a failure)', async () => {
    const { http } = fakeDaraja([
      { status: 500, body: { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' } },
      { status: 200, body: { ResultCode: '0', ResultDesc: 'The service request is processed successfully.' } },
      { status: 200, body: { ResultCode: '1032', ResultDesc: 'Request cancelled by user' } },
      { status: 503, body: { errorMessage: 'Service unavailable' } },
    ]);
    const mpesa = new DarajaProvider(config, http);
    expect(await mpesa.checkStatus('ws_CO_123')).toBe('PENDING');
    expect(await mpesa.checkStatus('ws_CO_123')).toBe('SUCCESSFUL');
    expect(await mpesa.checkStatus('ws_CO_123')).toBe('FAILED');
    await expect(mpesa.checkStatus('ws_CO_123')).rejects.toThrow(/Service unavailable/);
  });
});

describe('payment endpoints', () => {
  let db: Database;
  beforeAll(async () => {
    db = await openDatabase({});
  });
  afterAll(async () => {
    await db.close();
  });

  async function registered(app: Awaited<ReturnType<typeof createApp>>) {
    const base = await app.getUrl();
    const installationId = randomUUID();
    const token = `t-${randomUUID()}-${randomUUID()}`;
    await fetch(`${base}/v1/installations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId, token }) });
    await db.query(
      `INSERT INTO accounts (id, installation_id, account_name, phone_number, opening_balance, balance, version, currency, created_at, updated_at)
       VALUES ($1, $2, 'Paskal Twoli', '254759981287', 1000, 1000, 1, 'KES', now(), now())`,
      [randomUUID(), installationId],
    );
    return { base, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
  }

  it('say "not set up" when no provider is configured', async () => {
    const app = await createApp(db);
    await app.listen(0, '127.0.0.1');
    try {
      const { base, headers } = await registered(app);
      const res = await fetch(`${base}/v1/payments/tokens`, { method: 'POST', headers, body: JSON.stringify({ shillings: 50, phone: '0759981287', idempotencyKey: 'key-00001' }) });
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PAYMENTS_NOT_CONFIGURED');
    } finally {
      await app.close();
    }
  });

  it('buy tokens → pending → callback triggers verification → tokens credited once', async () => {
    let answer: 'PENDING' | 'SUCCESSFUL' = 'PENDING';
    const provider: PaymentProvider = {
      name: 'test-provider',
      initiate: async (p) => ({ providerReference: `ref-${p.id}` }),
      checkStatus: async () => answer,
    };
    const app = await createApp(db, { paymentProvider: provider });
    await app.listen(0, '127.0.0.1');
    try {
      const { base, headers } = await registered(app);
      const body = JSON.stringify({ shillings: 50, phone: '0759981287', idempotencyKey: 'key-00002' });
      const p = (await (await fetch(`${base}/v1/payments/tokens`, { method: 'POST', headers, body })).json()) as PaymentRecord;
      expect(p).toMatchObject({ status: 'PENDING', amount: 50, tokens: 50 });
      const same = (await (await fetch(`${base}/v1/payments/tokens`, { method: 'POST', headers, body })).json()) as PaymentRecord;
      expect(same.id).toBe(p.id);
      // a forged callback claiming success changes nothing: the provider still says PENDING
      await fetch(`${base}/v1/payments/mpesa/callback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: p.providerReference, ResultCode: 0 } } }) });
      expect(((await (await fetch(`${base}/v1/payments/${p.id}`, { headers })).json()) as PaymentRecord).status).toBe('PENDING');
      answer = 'SUCCESSFUL';
      await fetch(`${base}/v1/payments/mpesa/callback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: p.providerReference } } }) });
      await fetch(`${base}/v1/payments/${p.id}`, { headers });
      const wallet = (await (await fetch(`${base}/v1/wallet`, { headers })).json()) as { balances: { PURCHASED: number; total: number } };
      expect(wallet.balances).toMatchObject({ PURCHASED: 50, total: 50 });
      const pricing = (await (await fetch(`${base}/v1/pricing`, { headers })).json()) as { settings: { freeSimulationsOffline: boolean; shillingsPerToken: number } };
      expect(pricing.settings).toMatchObject({ freeSimulationsOffline: true, shillingsPerToken: 1 });
    } finally {
      await app.close();
    }
  });
});

describe('provider registry', () => {
  it('switches on exactly the providers whose credentials are set; PAYMENT_PROVIDER picks the default', async () => {
    const { providersFromEnv } = await import('../src/providers.js');
    expect(providersFromEnv({}).all).toEqual([]);
    const env = {
      MPESA_CONSUMER_KEY: 'k', MPESA_CONSUMER_SECRET: 's', MPESA_SHORTCODE: '174379', MPESA_PASSKEY: 'p', MPESA_CALLBACK_URL: 'https://x/cb',
      INTASEND_SECRET_KEY: 'ISSecretKey_test', PAYSTACK_SECRET_KEY: 'sk_test_x',
      KOPOKOPO_CLIENT_ID: 'id', KOPOKOPO_CLIENT_SECRET: 'secret', KOPOKOPO_TILL: 'K000000', KOPOKOPO_CALLBACK_URL: 'https://x/k',
      PAYHERO_API_USERNAME: 'u', PAYHERO_API_PASSWORD: 'p', PAYHERO_CHANNEL_ID: '123', PAYHERO_CALLBACK_URL: 'https://x/p',
      PAYMENT_PROVIDER: 'intasend',
    };
    const r = providersFromEnv(env);
    expect(r.all.map((p) => p.name)).toEqual(['mpesa-daraja', 'kopokopo', 'intasend', 'paystack', 'payhero']);
    expect(r.default?.name).toBe('intasend');
    expect(providersFromEnv({ ...env, PAYMENT_PROVIDER: undefined }).default?.name).toBe('mpesa-daraja');
  });
});
