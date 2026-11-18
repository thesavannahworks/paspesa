/**
 * Monetization foundation on the server (White Paper §26–33, Phase 6). The backend is authoritative for
 * pricing and token accounting (§27.6, §28.4). Nothing here is switched on for users yet: simulations stay
 * UNMETERED (product-owner decision) until a payment provider is connected and payments are switched on.
 * Owner decisions (2026-11-17): 1 token = KSh 1; buying tokens is 'pay KSh N, get N tokens'; Recharge is free;
 * free simulations may run offline (a back-office setting).
 *
 * Every wallet change runs in one database transaction with the wallet row locked, writes ledger lines per
 * grant lot, updates the lots and the balance caches together, and is idempotent on its reference.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_MONETIZATION_SETTINGS,
  DEFAULT_PRICING,
  directPrice,
  normalizeKenyanPhone,
  tokensForShillings,
  GRANT_ENTRY,
  canMovePayment,
  canMoveRefund,
  canMoveSimulation,
  planDeduction,
  planExpiry,
  priceSimulation,
  reconcileWallet,
  reservedTotal,
  validatePricingRule,
  walletBalances,
  type MonetizationSettings,
  type PaymentRecord,
  type PaymentStatus,
  type PricingConfiguration,
  type PricingRule,
  type PricingSnapshot,
  type SimulationType,
  type TokenCategory,
  type TokenLedgerEntry,
  type TokenLot,
} from '@paspesa/core';
import type { Database, Queryable } from './database.js';

export class MonetizationError extends Error {
  constructor(readonly code: 'INSUFFICIENT_TOKENS' | 'VALIDATION' | 'NOT_FOUND' | 'NOT_CONFIGURED' | 'INVALID_STATE', message: string) {
    super(message);
  }
}

/** A payment provider (M-PESA STK push, card…). None is connected yet; tests use a sandbox. */
export interface PaymentProvider {
  readonly name: string;
  /** Sends the payment request (an M-PESA STK prompt to `payment.payerPhone`). */
  initiate(payment: PaymentRecord): Promise<{ providerReference: string }>;
  /** The provider's actual status. Throws on timeout — which is NOT a failure (§33.1). */
  checkStatus(providerReference: string): Promise<'PENDING' | 'SUCCESSFUL' | 'FAILED'>;
}

const iso = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

interface LotRow { id: string; wallet_id: string; source_category: TokenCategory; original_quantity: number; remaining_quantity: number; reserved_quantity: number; created_at: Date; expires_at: Date | null; source_reference: string }
const toLot = (r: LotRow): TokenLot => ({
  id: r.id, walletId: r.wallet_id, category: r.source_category, originalQuantity: Number(r.original_quantity), remainingQuantity: Number(r.remaining_quantity), reservedQuantity: Number(r.reserved_quantity ?? 0),
  createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at), sourceReference: r.source_reference,
});

interface PaymentRow {
  id: string; owner_id: string; payment_type: PaymentRecord['paymentType']; provider: string; provider_reference: string | null; idempotency_key: string;
  amount: number; currency: 'KES'; status: PaymentStatus; tokens: number | null; payer_phone: string | null; related_simulation_id: string | null;
  simulation_status: PaymentRecord['simulationStatus']; refund_status: PaymentRecord['refundStatus']; created_at: Date; verified_at: Date | null;
}
const toPayment = (r: PaymentRow): PaymentRecord => ({
  id: r.id, ownerId: r.owner_id, paymentType: r.payment_type, provider: r.provider, providerReference: r.provider_reference, idempotencyKey: r.idempotency_key,
  amount: Number(r.amount), currency: r.currency, status: r.status, tokens: r.tokens === null ? null : Number(r.tokens), payerPhone: r.payer_phone, relatedSimulationId: r.related_simulation_id,
  simulationStatus: r.simulation_status, refundStatus: r.refund_status, createdAt: iso(r.created_at)!, verifiedAt: iso(r.verified_at),
});

export class MonetizationService {
  constructor(private readonly db: Database, private readonly now: () => string = () => new Date().toISOString()) {}

  // ------------------------------------------------------------------------------------------- pricing

  /** Active pricing configuration; seeds the agreed default the first time (§27.1). */
  async pricing(q: Queryable = this.db): Promise<PricingConfiguration> {
    let rows = await q.query<Record<string, unknown>>('SELECT * FROM pricing_rules ORDER BY id, version');
    if (!rows.length) {
      await this.insertRule(q, DEFAULT_PRICING.rules[0]!);
      await q.query('INSERT INTO pricing_meta (id, version) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [DEFAULT_PRICING.version]);
      rows = await q.query('SELECT * FROM pricing_rules ORDER BY id, version');
    }
    const [meta] = await q.query<{ version: number }>('SELECT version FROM pricing_meta WHERE id = 1');
    return {
      version: Number(meta?.version ?? 1),
      rules: rows.map((r) => ({
        id: String(r.id), version: Number(r.version), scopeType: r.scope_type as PricingRule['scopeType'], scopeId: (r.scope_id as string | null) ?? null,
        transactionType: (r.transaction_type as SimulationType | null) ?? null, formula: r.formula_type as PricingRule['formula'],
        freeThreshold: Number(r.free_threshold), amountPerToken: r.amount_per_token === null ? null : Number(r.amount_per_token),
        tiers: (r.tier_configuration as PricingRule['tiers']) ?? null, effectiveFrom: iso(r.effective_from)!, effectiveTo: iso(r.effective_to),
        status: r.status as PricingRule['status'],
      })),
    };
  }

  private insertRule(q: Queryable, r: PricingRule) {
    return q.query(
      `INSERT INTO pricing_rules (id, version, scope_type, scope_id, transaction_type, formula_type, free_threshold, amount_per_token, tier_configuration, effective_from, effective_to, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [r.id, r.version, r.scopeType, r.scopeId, r.transactionType, r.formula, r.freeThreshold, r.amountPerToken, r.tiers ? JSON.stringify(r.tiers) : null, r.effectiveFrom, r.effectiveTo, r.status],
    );
  }

  /**
   * Publishes a rule as a NEW version (old versions stay for history, §27.5). The previous version of the
   * same rule stops at the new one's effective date. Audited.
   */
  async publishRule(rule: Omit<PricingRule, 'version'>, actor: string): Promise<PricingRule> {
    const problems = validatePricingRule({ ...rule, version: 1 });
    if (problems.length) throw new MonetizationError('VALIDATION', problems.join('; '));
    return this.db.transaction(async (q) => {
      await this.pricing(q); // make sure the default exists
      const [last] = await q.query<{ version: number }>('SELECT max(version) AS version FROM pricing_rules WHERE id = $1', [rule.id]);
      const version = Number(last?.version ?? 0) + 1;
      await q.query('UPDATE pricing_rules SET effective_to = $2 WHERE id = $1 AND effective_to IS NULL AND status = \'ACTIVE\'', [rule.id, rule.effectiveFrom]);
      const published: PricingRule = { ...rule, version };
      await this.insertRule(q, published);
      await q.query('UPDATE pricing_meta SET version = version + 1 WHERE id = 1');
      await q.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after_value) VALUES ($1, $2, $3, $4, $5)', [actor, 'PUBLISH_PRICING_RULE', 'PRICING_RULE', rule.id, JSON.stringify(published)]);
      return published;
    });
  }

  async quote(accountId: string, type: SimulationType, amount: number): Promise<PricingSnapshot> {
    return priceSimulation(await this.pricing(), { accountId, type, amount, at: this.now() });
  }

  // ------------------------------------------------------------------------------------------- wallet

  /** @internal shared with AllocationService */
  async lockWallet(q: Queryable, accountId: string): Promise<string> {
    await q.query('INSERT INTO token_wallets (id, owner_id) VALUES ($1, $2) ON CONFLICT (owner_id) DO NOTHING', [randomUUID(), accountId]);
    const [w] = await q.query<{ id: string }>('SELECT id FROM token_wallets WHERE owner_id = $1 FOR UPDATE', [accountId]);
    if (!w) throw new MonetizationError('NOT_FOUND', 'Account not found');
    return w.id;
  }

  /** @internal */
  async lots(q: Queryable, walletId: string): Promise<TokenLot[]> {
    return (await q.query<LotRow>('SELECT * FROM token_lots WHERE wallet_id = $1 ORDER BY created_at, id FOR UPDATE', [walletId])).map(toLot);
  }

  /** @internal */
  async ledgerLine(q: Queryable, e: Omit<TokenLedgerEntry, 'id' | 'createdAt'>) {
    await q.query(
      `INSERT INTO token_ledger (id, wallet_id, entry_type, source_category, quantity, direction, reference_type, reference_id, grant_lot_id, device_id, created_at, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [randomUUID(), e.walletId, e.entryType, e.category, e.quantity, e.direction, e.referenceType, e.referenceId, e.lotId, e.deviceId, this.now(), e.expiresAt, e.metadata ? JSON.stringify(e.metadata) : null],
    );
  }

  /** Recomputes the caches from the lots (kept equal to the ledger, §28.4). */
  /** @internal */
  async refreshCaches(q: Queryable, walletId: string) {
    const b = walletBalances(await this.lots(q, walletId), this.now());
    await q.query(
      `UPDATE token_wallets SET total_balance_cache = $2, purchased_balance_cache = $3, promotional_balance_cache = $4, admin_balance_cache = $5,
       version = version + 1, updated_at = now() WHERE id = $1`,
      [walletId, b.total, b.PURCHASED, b.PROMOTIONAL, b.ADMIN],
    );
    return b;
  }

  /**
   * Credits tokens as a new grant lot. Idempotent on `reference`: the same payment / promotion / admin action
   * can never credit twice (§31, §47.8).
   */
  async grant(input: { accountId: string; category: TokenCategory; quantity: number; reference: string; expiresAt?: string | null; actor: string }) {
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new MonetizationError('VALIDATION', 'Quantity must be a whole number above zero');
    if (input.category === 'PURCHASED' && input.expiresAt) throw new MonetizationError('VALIDATION', 'Purchased tokens do not expire');
    return this.db.transaction(async (q) => {
      const walletId = await this.lockWallet(q, input.accountId);
      const lotId = randomUUID();
      const inserted = await q.query<{ id: string }>(
        `INSERT INTO token_lots (id, wallet_id, source_category, original_quantity, remaining_quantity, created_at, expires_at, source_reference)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7) ON CONFLICT (wallet_id, source_reference) DO NOTHING RETURNING id`,
        [lotId, walletId, input.category, input.quantity, this.now(), input.expiresAt ?? null, input.reference],
      );
      if (!inserted.length) return { duplicate: true as const, balances: walletBalances(await this.lots(q, walletId), this.now()) };
      await this.ledgerLine(q, {
        walletId, entryType: GRANT_ENTRY[input.category], category: input.category, quantity: input.quantity, direction: 'CREDIT',
        referenceType: input.category === 'PURCHASED' ? 'PAYMENT' : input.category === 'PROMOTIONAL' ? 'PROMOTION' : 'ADMIN',
        referenceId: input.reference, lotId, deviceId: null, expiresAt: input.expiresAt ?? null, metadata: { actor: input.actor },
      });
      return { duplicate: false as const, balances: await this.refreshCaches(q, walletId) };
    });
  }

  /**
   * Spends the priced tokens for one simulation (promotional → admin → purchased, §28.2). Idempotent per
   * simulation: a retry returns the original spend (§47.6). The ledger records exactly which lots paid.
   */
  async spendForSimulation(input: { accountId: string; simulationId: string; pricing: PricingSnapshot; deviceId?: string | null }) {
    return this.db.transaction(async (q) => {
      const walletId = await this.lockWallet(q, input.accountId);
      const [existing] = await q.query<{ quantity: number; status: string }>('SELECT quantity, status FROM token_spends WHERE wallet_id = $1 AND simulation_id = $2', [walletId, input.simulationId]);
      if (existing) return { duplicate: true as const, quantity: Number(existing.quantity), status: existing.status };
      const quantity = input.pricing.tokenCost;
      const plan = planDeduction(await this.lots(q, walletId), quantity, this.now());
      if (!plan.ok) throw new MonetizationError('INSUFFICIENT_TOKENS', `This simulation costs ${quantity} tokens; ${plan.available} are available`);
      for (const d of plan.deductions) {
        await q.query('UPDATE token_lots SET remaining_quantity = remaining_quantity - $2 WHERE id = $1', [d.lotId, d.quantity]);
        await this.ledgerLine(q, {
          walletId, entryType: 'SIMULATION_EXPENDITURE', category: d.category, quantity: d.quantity, direction: 'DEBIT', referenceType: 'SIMULATION',
          referenceId: input.simulationId, lotId: d.lotId, deviceId: input.deviceId ?? null, expiresAt: null, metadata: null,
        });
      }
      await q.query('INSERT INTO token_spends (wallet_id, simulation_id, quantity, pricing, status, created_at) VALUES ($1, $2, $3, $4, \'SPENT\', $5)', [walletId, input.simulationId, quantity, JSON.stringify(input.pricing), this.now()]);
      return { duplicate: false as const, quantity, deductions: plan.deductions, balances: await this.refreshCaches(q, walletId) };
    });
  }

  /**
   * The simulation did not complete: restore exactly the lots it spent, as separate reversal lines
   * (the original deduction stays, §33.2). Idempotent.
   */
  async reverseSimulation(input: { accountId: string; simulationId: string; reason: string }) {
    return this.db.transaction(async (q) => {
      const walletId = await this.lockWallet(q, input.accountId);
      const [spend] = await q.query<{ status: string }>('SELECT status FROM token_spends WHERE wallet_id = $1 AND simulation_id = $2 FOR UPDATE', [walletId, input.simulationId]);
      if (!spend) throw new MonetizationError('NOT_FOUND', 'No token spend for this simulation');
      if (spend.status === 'REVERSED') return { duplicate: true as const };
      const debits = await q.query<{ grant_lot_id: string; source_category: TokenCategory; quantity: number }>(
        "SELECT grant_lot_id, source_category, quantity FROM token_ledger WHERE wallet_id = $1 AND reference_type = 'SIMULATION' AND reference_id = $2 AND entry_type = 'SIMULATION_EXPENDITURE'",
        [walletId, input.simulationId],
      );
      for (const d of debits) {
        await q.query('UPDATE token_lots SET remaining_quantity = remaining_quantity + $2 WHERE id = $1', [d.grant_lot_id, d.quantity]);
        await this.ledgerLine(q, {
          walletId, entryType: 'EXPENDITURE_REVERSAL', category: d.source_category, quantity: Number(d.quantity), direction: 'CREDIT', referenceType: 'SIMULATION',
          referenceId: input.simulationId, lotId: d.grant_lot_id, deviceId: null, expiresAt: null, metadata: { reason: input.reason },
        });
      }
      await q.query("UPDATE token_spends SET status = 'REVERSED', reversed_at = $3 WHERE wallet_id = $1 AND simulation_id = $2", [walletId, input.simulationId, this.now()]);
      return { duplicate: false as const, balances: await this.refreshCaches(q, walletId) };
    });
  }

  /** Expires every lot past its date: a permanent EXPIRATION line per lot (§28.3). Safe to run repeatedly. */
  async expireDue(): Promise<number> {
    const wallets = await this.db.query<{ id: string; owner_id: string }>(
      'SELECT DISTINCT w.id, w.owner_id FROM token_wallets w JOIN token_lots l ON l.wallet_id = w.id WHERE l.remaining_quantity > 0 AND l.expires_at <= $1',
      [this.now()],
    );
    let expired = 0;
    for (const w of wallets) {
      await this.db.transaction(async (q) => {
        await this.lockWallet(q, w.owner_id);
        const lots = await this.lots(q, w.id);
        for (const e of planExpiry(lots, this.now())) {
          const lot = lots.find((l) => l.id === e.lotId)!;
          // Only the unreserved part expires; tokens reserved on a device are settled at release / forfeiture.
          await q.query('UPDATE token_lots SET remaining_quantity = remaining_quantity - $2 WHERE id = $1', [e.lotId, e.quantity]);
          await this.ledgerLine(q, {
            walletId: w.id, entryType: 'EXPIRATION', category: e.category, quantity: e.quantity, direction: 'DEBIT', referenceType: 'EXPIRY',
            referenceId: lot.sourceReference, lotId: e.lotId, deviceId: null, expiresAt: lot.expiresAt, metadata: { originalGrant: lot.sourceReference, expiredOn: lot.expiresAt },
          });
          expired += e.quantity;
        }
        await this.refreshCaches(q, w.id);
      });
    }
    return expired;
  }

  async wallet(accountId: string) {
    const [w] = await this.db.query<{ id: string }>('SELECT id FROM token_wallets WHERE owner_id = $1', [accountId]);
    if (!w) return { balances: { PROMOTIONAL: 0, ADMIN: 0, PURCHASED: 0, total: 0 }, reservedForDevices: 0, ledger: [] };
    const lots = (await this.db.query<LotRow>('SELECT * FROM token_lots WHERE wallet_id = $1', [w.id])).map(toLot);
    const ledger = await this.db.query<Record<string, unknown>>(
      'SELECT entry_type, source_category, quantity, direction, reference_type, reference_id, created_at FROM token_ledger WHERE wallet_id = $1 ORDER BY seq DESC LIMIT 100',
      [w.id],
    );
    return {
      balances: walletBalances(lots, this.now()),
      reservedForDevices: reservedTotal(lots),
      ledger: ledger.map((e) => ({ type: e.entry_type, category: e.source_category, quantity: Number(e.quantity), direction: e.direction, reference: `${e.reference_type}:${e.reference_id}`, at: iso(e.created_at) })),
    };
  }

  /** §28.4: lots vs ledger, and caches vs lots. Empty = consistent. */
  async reconcile(accountId: string): Promise<string[]> {
    const [w] = await this.db.query<Record<string, unknown>>('SELECT * FROM token_wallets WHERE owner_id = $1', [accountId]);
    if (!w) return [];
    const lots = (await this.db.query<LotRow>('SELECT * FROM token_lots WHERE wallet_id = $1', [w.id])).map(toLot);
    const ledger = (await this.db.query<Record<string, unknown>>('SELECT * FROM token_ledger WHERE wallet_id = $1', [w.id])).map((e) => ({
      id: String(e.id), walletId: String(e.wallet_id), entryType: e.entry_type, category: e.source_category, quantity: Number(e.quantity), direction: e.direction,
      referenceType: e.reference_type, referenceId: String(e.reference_id), lotId: String(e.grant_lot_id), deviceId: null, createdAt: iso(e.created_at)!, expiresAt: null, metadata: null,
    })) as TokenLedgerEntry[];
    const problems = reconcileWallet(lots, ledger);
    // Reserved tokens must be exactly what active device allocations still hold (§29).
    const held = await this.db.query<{ lot_id: string; held: number }>(
      `SELECT al.lot_id, sum(al.quantity - al.spent)::bigint AS held FROM allocation_lots al
       JOIN device_allocations d ON d.id = al.allocation_id WHERE d.wallet_id = $1 AND d.status = 'ACTIVE' GROUP BY al.lot_id`,
      [w.id],
    );
    const heldBy = new Map(held.map((h) => [h.lot_id, Number(h.held)] as const));
    for (const lot of lots) {
      if ((heldBy.get(lot.id) ?? 0) !== lot.reservedQuantity) problems.push(`Lot ${lot.id}: reserved ${lot.reservedQuantity}, allocations hold ${heldBy.get(lot.id) ?? 0}`);
    }
    const b = walletBalances(lots, this.now());
    if (Number(w.total_balance_cache) !== b.total) problems.push(`Cached total ${w.total_balance_cache} ≠ ${b.total}`);
    return problems;
  }

  // ------------------------------------------------------------------------------------------- payments

  private async paymentEvent(q: Queryable, paymentId: string, event: string, detail: unknown = null) {
    await q.query('INSERT INTO payment_events (payment_id, event, detail) VALUES ($1, $2, $3)', [paymentId, event, detail === null ? null : JSON.stringify(detail)]);
  }

  // ------------------------------------------------------------------------------------------- settings

  async settings(q: Queryable = this.db): Promise<MonetizationSettings> {
    const [row] = await q.query<{ settings: Partial<MonetizationSettings> }>('SELECT settings FROM monetization_settings WHERE id = 1');
    return { ...DEFAULT_MONETIZATION_SETTINGS, ...(row?.settings ?? {}) };
  }

  /**
   * The settings in force at a moment (an offline simulation is judged by the settings when it happened).
   * Before any recorded change: the defaults (payments off). A time in the future counts as now.
   */
  async settingsAt(q: Queryable, at: string): Promise<MonetizationSettings> {
    const when = Math.min(Date.parse(at) || Date.now(), Date.now());
    const [row] = await q.query<{ settings: Partial<MonetizationSettings> }>(
      'SELECT settings FROM monetization_settings_history WHERE effective_from <= $1 ORDER BY effective_from DESC, id DESC LIMIT 1',
      [new Date(when).toISOString()],
    );
    if (row) return { ...DEFAULT_MONETIZATION_SETTINGS, ...row.settings };
    const [any] = await q.query<{ n: string }>('SELECT count(*) AS n FROM monetization_settings_history');
    return Number(any?.n ?? 0) ? DEFAULT_MONETIZATION_SETTINGS : this.settings(q);
  }

  /** Back-office change of settings (audited). */
  async updateSettings(patch: Partial<MonetizationSettings>, actor: string): Promise<MonetizationSettings> {
    const current = await this.settings();
    const next = { ...current, ...patch };
    if (typeof next.paymentRequired !== 'boolean' || typeof next.freeSimulationsOffline !== 'boolean') throw new MonetizationError('VALIDATION', 'Switches must be true or false');
    if (!Number.isSafeInteger(next.shillingsPerToken) || next.shillingsPerToken < 1) throw new MonetizationError('VALIDATION', 'Shillings per token must be a whole number of at least 1');
    if (!Number.isSafeInteger(next.minimumPurchase) || next.minimumPurchase < 1) throw new MonetizationError('VALIDATION', 'Minimum purchase must be at least KSh 1');
    if (!Number.isSafeInteger(next.offlineAuthorizationDays) || next.offlineAuthorizationDays < 1 || next.offlineAuthorizationDays > 90) throw new MonetizationError('VALIDATION', 'Offline authorization must be 1 to 90 days');
    await this.db.transaction(async (q) => {
      await q.query('INSERT INTO monetization_settings (id, settings) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET settings = excluded.settings, updated_at = now()', [JSON.stringify(next)]);
      await q.query('INSERT INTO monetization_settings_history (effective_from, settings) VALUES (now(), $1)', [JSON.stringify(next)]);
      await q.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before_value, after_value) VALUES ($1, $2, $3, $4, $5, $6)', [
        actor, 'UPDATE_MONETIZATION_SETTINGS', 'SETTINGS', 'monetization', JSON.stringify(current), JSON.stringify(next),
      ]);
    });
    return next;
  }

  // ------------------------------------------------------------------------------------------- purchases

  private payer(phone: string): string {
    const normalized = normalizeKenyanPhone(phone);
    if (!normalized) throw new MonetizationError('VALIDATION', 'Enter a valid M-PESA number');
    return normalized;
  }

  /**
   * Buys tokens (§31): pay KSh N, get N tokens at the token rate (1 token = KSh 1, owner decision). Idempotent
   * on the client's key: a repeated request never charges twice. Tokens are credited only after verification.
   */
  async initiateTokenPurchase(input: { accountId: string; shillings: number; phone: string; idempotencyKey: string }, provider: PaymentProvider): Promise<PaymentRecord> {
    const settings = await this.settings();
    if (!Number.isSafeInteger(input.shillings) || input.shillings < settings.minimumPurchase) throw new MonetizationError('VALIDATION', `The smallest purchase is KSh ${settings.minimumPurchase}`);
    const tokens = tokensForShillings(input.shillings, settings);
    if (tokens < 1) throw new MonetizationError('VALIDATION', 'That amount buys no tokens');
    return this.startPayment(
      { accountId: input.accountId, idempotencyKey: input.idempotencyKey, type: 'TOKEN_PURCHASE', amount: input.shillings, tokens, phone: this.payer(input.phone), simulationId: null },
      provider,
    );
  }

  /**
   * Pay-per-simulation (§32): the price is the simulation's token cost in shillings (20 tokens → KSh 20),
   * computed here from the server's pricing — never taken from the client. Free simulations need no payment.
   * The simulation is authorized only once this payment is verified successful.
   */
  async initiateDirectPayment(
    input: { accountId: string; simulationId: string; type: SimulationType; simulationAmount: number; phone: string; idempotencyKey: string },
    provider: PaymentProvider,
  ): Promise<{ payment: PaymentRecord; pricing: PricingSnapshot }> {
    const pricing = await this.quote(input.accountId, input.type, input.simulationAmount);
    const amount = directPrice(pricing, await this.settings());
    if (amount <= 0) throw new MonetizationError('VALIDATION', 'This simulation is free; no payment is needed');
    const payment = await this.startPayment(
      { accountId: input.accountId, idempotencyKey: input.idempotencyKey, type: 'DIRECT_SIMULATION', amount, tokens: null, phone: this.payer(input.phone), simulationId: input.simulationId },
      provider,
    );
    return { payment, pricing };
  }

  /** Re-checks every payment still waiting on the provider (run periodically). */
  async verifyPendingPayments(provider: PaymentProvider): Promise<number> {
    const pending = await this.db.query<{ id: string }>("SELECT id FROM payments WHERE status = 'PENDING' AND provider = $1 ORDER BY created_at LIMIT 50", [provider.name]);
    for (const p of pending) await this.verifyPayment(p.id, provider);
    return pending.length;
  }

  async paymentByProviderReference(provider: string, reference: string): Promise<PaymentRecord | null> {
    const [row] = await this.db.query<PaymentRow>('SELECT * FROM payments WHERE provider = $1 AND provider_reference = $2', [provider, reference]);
    return row ? toPayment(row) : null;
  }

  async paymentForProvider(provider: string, id: string): Promise<PaymentRecord | null> {
    const [row] = await this.db.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 AND provider = $2', [id, provider]);
    return row ? toPayment(row) : null;
  }

  /** The account's payments, newest first (purchase history). */
  async payments(ownerId: string): Promise<PaymentRecord[]> {
    return (await this.db.query<PaymentRow>('SELECT * FROM payments WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100', [ownerId])).map(toPayment);
  }

  async payment(ownerId: string, id: string): Promise<PaymentRecord | null> {
    const [row] = await this.db.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 AND owner_id = $2', [id, ownerId]);
    return row ? toPayment(row) : null;
  }

  private async startPayment(
    input: { accountId: string; idempotencyKey: string; type: PaymentRecord['paymentType']; amount: number; tokens: number | null; phone: string; simulationId: string | null },
    provider: PaymentProvider,
  ): Promise<PaymentRecord> {
    const payment = await this.db.transaction(async (q) => {
      const [existing] = await q.query<PaymentRow>('SELECT * FROM payments WHERE owner_id = $1 AND idempotency_key = $2', [input.accountId, input.idempotencyKey]);
      // A retry of a request the provider never accepted sends the prompt again (same payment, no new charge).
      if (existing) return { record: toPayment(existing), created: existing.status === 'INITIATED' && !existing.provider_reference };
      const record: PaymentRecord = {
        id: randomUUID(), ownerId: input.accountId, paymentType: input.type, provider: provider.name, providerReference: null, idempotencyKey: input.idempotencyKey,
        amount: input.amount, currency: 'KES', status: 'INITIATED', tokens: input.tokens, payerPhone: input.phone, relatedSimulationId: input.simulationId,
        simulationStatus: input.type === 'DIRECT_SIMULATION' ? 'AWAITING_PAYMENT' : 'NOT_APPLICABLE', refundStatus: 'NONE', createdAt: this.now(), verifiedAt: null,
      };
      await q.query(
        `INSERT INTO payments (id, owner_id, payment_type, provider, provider_reference, idempotency_key, amount, currency, status, tokens, payer_phone, related_simulation_id, simulation_status, refund_status, created_at)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, 'KES', 'INITIATED', $7, $8, $9, $10, 'NONE', $11)`,
        [record.id, record.ownerId, record.paymentType, record.provider, record.idempotencyKey, record.amount, record.tokens, record.payerPhone, record.relatedSimulationId, record.simulationStatus, record.createdAt],
      );
      await this.paymentEvent(q, record.id, 'INITIATED');
      return { record, created: true };
    });
    if (!payment.created) return payment.record;
    const { providerReference } = await provider.initiate(payment.record);
    return this.db.transaction(async (q) => {
      await q.query("UPDATE payments SET provider_reference = $2, status = 'PENDING' WHERE id = $1", [payment.record.id, providerReference]);
      await this.paymentEvent(q, payment.record.id, 'PENDING', { providerReference });
      const [row] = await q.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [payment.record.id]);
      return toPayment(row!);
    });
  }

  /**
   * Verifies a payment with the provider (callbacks are never trusted on their own, §31.6). A timeout keeps
   * it PENDING (§33.1). A verified token purchase credits PURCHASED tokens exactly once (§47.8).
   */
  async verifyPayment(paymentId: string, provider: PaymentProvider): Promise<PaymentRecord> {
    const [current] = await this.db.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [paymentId]);
    if (!current) throw new MonetizationError('NOT_FOUND', 'Payment not found');
    if (current.status === 'SUCCESSFUL' || current.status === 'FAILED' || !current.provider_reference) return toPayment(current);
    let status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
    try {
      status = await provider.checkStatus(current.provider_reference);
    } catch (e) {
      await this.db.transaction((q) => this.paymentEvent(q, paymentId, 'STATUS_CHECK_TIMEOUT', { error: e instanceof Error ? e.message : String(e) }));
      return toPayment(current);
    }
    const updated = await this.db.transaction(async (q) => {
      const [row] = await q.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (!row || !canMovePayment(row.status, status) || row.status === status) return toPayment(row!);
      await q.query('UPDATE payments SET status = $2, verified_at = CASE WHEN $2 = \'PENDING\' THEN verified_at ELSE $3::timestamptz END WHERE id = $1', [paymentId, status, this.now()]);
      await this.paymentEvent(q, paymentId, `VERIFIED_${status}`);
      if (row.payment_type === 'DIRECT_SIMULATION' && status !== 'PENDING') {
        // Only a verified successful payment authorizes the simulation (§32).
        await q.query('UPDATE payments SET simulation_status = $2 WHERE id = $1', [paymentId, status === 'SUCCESSFUL' ? 'AUTHORIZED' : 'FAILED']);
        await this.paymentEvent(q, paymentId, status === 'SUCCESSFUL' ? 'SIMULATION_AUTHORIZED' : 'SIMULATION_NOT_AUTHORIZED');
      }
      const [after] = await q.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [paymentId]);
      return toPayment(after!);
    });
    if (updated.status === 'SUCCESSFUL' && updated.paymentType === 'TOKEN_PURCHASE' && updated.tokens) {
      // Idempotent on the payment reference: repeated verifications or callbacks never credit twice.
      await this.grant({ accountId: updated.ownerId, category: 'PURCHASED', quantity: updated.tokens, reference: `payment:${updated.id}`, actor: `payment:${updated.provider}` });
    }
    return updated;
  }

  /**
   * Records how a directly-paid simulation ended. If it failed after the payment succeeded, the user gets a
   * refundable credit for the full amount (§33) — the payment is never silently kept.
   */
  async recordDirectSimulationResult(paymentId: string, outcome: 'SUCCESSFUL' | 'FAILED'): Promise<PaymentRecord> {
    return this.db.transaction(async (q) => {
      const [row] = await q.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (!row || row.payment_type !== 'DIRECT_SIMULATION') throw new MonetizationError('NOT_FOUND', 'Direct payment not found');
      if (row.simulation_status === outcome) return toPayment(row);
      if (!canMoveSimulation(row.simulation_status, outcome)) throw new MonetizationError('INVALID_STATE', `Simulation is already ${row.simulation_status}`);
      await q.query('UPDATE payments SET simulation_status = $2 WHERE id = $1', [paymentId, outcome]);
      await this.paymentEvent(q, paymentId, `SIMULATION_${outcome}`);
      if (outcome === 'FAILED' && row.status === 'SUCCESSFUL' && canMoveRefund(row.refund_status, 'REFUNDABLE_CREDIT')) {
        await q.query("UPDATE payments SET refund_status = 'REFUNDABLE_CREDIT' WHERE id = $1", [paymentId]);
        await q.query("INSERT INTO payment_credits (id, owner_id, payment_id, amount, status) VALUES ($1, $2, $3, $4, 'AVAILABLE') ON CONFLICT (payment_id) DO NOTHING", [randomUUID(), row.owner_id, paymentId, row.amount]);
        await this.paymentEvent(q, paymentId, 'REFUNDABLE_CREDIT_ISSUED', { amount: Number(row.amount) });
      }
      const [after] = await q.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [paymentId]);
      return toPayment(after!);
    });
  }
}
