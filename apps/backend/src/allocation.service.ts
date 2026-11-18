/**
 * Device token allocations (White Paper §29, §37.12).
 *
 * The central wallet stays the source of truth. A device, while online, RESERVES tokens inside their grant
 * lots (categories and the promotional → admin → purchased order are preserved) and receives an
 * authorization window (default 3 days, back-office setting) plus the pricing configuration to use offline
 * (§27.6). Other devices cannot spend reserved tokens.
 *
 *  - Spend: when the device's token-funded simulations sync, each is re-priced with the allocation's pricing
 *    and becomes a real SIMULATION_EXPENDITURE from the reserved lots (once per simulation).
 *  - Renewal: every sync (or an explicit renew) refreshes the authorization window and the pricing.
 *  - Expiry of the window stops new paid offline simulations; records made before it still reconcile and the
 *    allocation is NOT returned automatically (§29.4).
 *  - Release (online only): unused reserved tokens go back to the central balance, only if the device's
 *    spending is fully reconciled with the server (§29.2).
 *  - Lost device: unreconciled reserved tokens are forfeited as a permanent ledger event; no transactions are
 *    invented to explain them (§29.5).
 */
import { randomUUID } from 'node:crypto';
import {
  planAllocationSpend,
  planDeduction,
  priceSimulation,
  type PricingConfiguration,
  type PricingSnapshot,
  type ServerAllocation,
  type SimulationType,
  type TokenCategory,
  tokenSplit,
} from '@paspesa/core';
import type { Database, Queryable } from './database.js';
import { MonetizationError, type MonetizationService } from './monetization.service.js';

interface AllocationRow {
  id: string;
  wallet_id: string;
  device_id: string;
  allocated_quantity: number;
  spent_quantity: number;
  released_quantity: number;
  forfeited_quantity: number;
  pricing: PricingConfiguration;
  authorization_expires_at: Date | string;
  status: 'ACTIVE' | 'RELEASED' | 'FORFEITED';
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const unused = (a: AllocationRow) => Number(a.allocated_quantity) - Number(a.spent_quantity) - Number(a.released_quantity) - Number(a.forfeited_quantity);

export type SpendOutcome = { ok: true } | { ok: false; code: 'INSUFFICIENT_TOKENS' | 'AUTHORIZATION_EXPIRED' | 'PRICING_MISMATCH'; message: string };

export class AllocationService {
  constructor(
    private readonly db: Database,
    private readonly money: MonetizationService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async active(q: Queryable, deviceId: string, lock = false): Promise<AllocationRow | null> {
    const [row] = await q.query<AllocationRow>(`SELECT * FROM device_allocations WHERE device_id = $1 AND status = 'ACTIVE'${lock ? ' FOR UPDATE' : ''}`, [deviceId]);
    return row ?? null;
  }

  private async accountOf(q: Queryable, deviceId: string): Promise<string> {
    const [row] = await q.query<{ id: string; status: string }>(
      'SELECT a.id, i.status FROM installations i JOIN accounts a ON a.id = i.account_id WHERE i.id = $1',
      [deviceId],
    );
    if (!row) throw new MonetizationError('NOT_FOUND', 'This device has no synchronized account yet');
    if (row.status !== 'ACTIVE') throw new MonetizationError('INVALID_STATE', 'This device is no longer active');
    return row.id;
  }

  private async expiresAt(q: Queryable): Promise<string> {
    const days = (await this.money.settings(q)).offlineAuthorizationDays;
    return new Date(Date.parse(this.now()) + days * 86_400_000).toISOString();
  }

  /** What the device should hold: remaining = unused (allocated − spent − released − forfeited). */
  status(row: AllocationRow | null): ServerAllocation | null {
    return row ? { allocationId: row.id, remaining: unused(row), authorizationExpiresAt: iso(row.authorization_expires_at), pricing: row.pricing } : null;
  }

  async current(deviceId: string): Promise<ServerAllocation | null> {
    return this.status(await this.active(this.db, deviceId));
  }

  /** Reserves `quantity` more tokens for the device (creating its allocation if needed). Online only. */
  async allocate(deviceId: string, quantity: number): Promise<ServerAllocation> {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new MonetizationError('VALIDATION', 'Choose how many tokens to set aside');
    return this.db.transaction(async (q) => {
      const accountId = await this.accountOf(q, deviceId);
      const walletId = await this.money.lockWallet(q, accountId);
      const plan = planDeduction(await this.money.lots(q, walletId), quantity, this.now());
      if (!plan.ok) throw new MonetizationError('INSUFFICIENT_TOKENS', `Only ${plan.available} tokens are available to set aside`);
      let alloc = await this.active(q, deviceId, true);
      const pricing = await this.money.pricing(q);
      const expires = await this.expiresAt(q);
      if (!alloc) {
        const id = randomUUID();
        await q.query(
          `INSERT INTO device_allocations (id, wallet_id, device_id, pricing, authorization_started_at, authorization_expires_at, last_renewed_at, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $5, 'ACTIVE', $5)`,
          [id, walletId, deviceId, JSON.stringify(pricing), this.now(), expires],
        );
        alloc = (await this.active(q, deviceId, true))!;
      }
      for (const d of plan.deductions) {
        await q.query('UPDATE token_lots SET reserved_quantity = reserved_quantity + $2 WHERE id = $1', [d.lotId, d.quantity]);
        await q.query(
          `INSERT INTO allocation_lots (allocation_id, lot_id, category, quantity) VALUES ($1, $2, $3, $4)
           ON CONFLICT (allocation_id, lot_id) DO UPDATE SET quantity = allocation_lots.quantity + excluded.quantity`,
          [alloc.id, d.lotId, d.category, d.quantity],
        );
        await this.money.ledgerLine(q, {
          walletId, entryType: 'DEVICE_ALLOCATION', category: d.category, quantity: d.quantity, direction: 'DEBIT', referenceType: 'DEVICE',
          referenceId: alloc.id, lotId: d.lotId, deviceId, expiresAt: null, metadata: null,
        });
      }
      await q.query(
        'UPDATE device_allocations SET allocated_quantity = allocated_quantity + $2, pricing = $3, authorization_expires_at = $4, last_renewed_at = $5 WHERE id = $1',
        [alloc.id, quantity, JSON.stringify(pricing), expires, this.now()],
      );
      await this.money.refreshCaches(q, walletId);
      return this.status(await this.active(q, deviceId))!;
    });
  }

  /** Refreshes the authorization window and the pricing (every sync does this, §29.4). */
  async renew(deviceId: string, q: Queryable = this.db): Promise<ServerAllocation | null> {
    const alloc = await this.active(q, deviceId);
    if (!alloc) return null;
    const [device] = await q.query<{ status: string }>('SELECT status FROM installations WHERE id = $1', [deviceId]);
    if (device?.status !== 'ACTIVE') return this.status(alloc);
    await q.query('UPDATE device_allocations SET authorization_expires_at = $2, pricing = $3, last_renewed_at = $4 WHERE id = $1', [
      alloc.id, await this.expiresAt(q), JSON.stringify(await this.money.pricing(q)), this.now(),
    ]);
    return this.status(await this.active(q, deviceId));
  }

  /**
   * Charges a synced token-paid simulation, inside the sync transaction. Idempotent per simulation.
   *
   *  - `central` tokens come from the central balance; the rest from this device's set-aside tokens.
   *  - Normally the price is recomputed (with the allocation's pricing when the device used it) and must
   *    match what the device charged.
   *  - `reviewed` (a reviewer applies a held simulation): the device's price is accepted and the tokens are
   *    taken wherever they still are — this device's set-aside tokens first, then the central balance. A
   *    reviewed simulation is never stored for free just because it was held.
   *
   * Both sources are checked before anything is deducted, so a refusal leaves no partial charge.
   */
  async chargeSimulation(
    q: Queryable,
    input: {
      accountId: string; deviceId: string; simulationId: string; type: SimulationType; amount: number; completedAt: string;
      method: 'TOKENS' | 'WALLET'; central: number; claimed: PricingSnapshot | null; reviewed?: boolean;
    },
  ): Promise<SpendOutcome> {
    const walletId = await this.money.lockWallet(q, input.accountId);
    const [already] = await q.query('SELECT 1 FROM token_spends WHERE wallet_id = $1 AND simulation_id = $2', [walletId, input.simulationId]);
    if (already) return { ok: true };
    const alloc = await this.active(q, input.deviceId, true);
    const unusedNow = alloc ? unused(alloc) : 0;

    let cost: number;
    let pricing: PricingSnapshot;
    let split: { device: number; central: number };
    if (input.reviewed) {
      if (!input.claimed) return { ok: false, code: 'PRICING_MISMATCH', message: 'The record has no price' };
      pricing = input.claimed;
      cost = pricing.tokenCost;
      const device = Math.min(cost, unusedNow);
      split = { device, central: cost - device };
    } else {
      const config = input.method === 'TOKENS' && alloc ? alloc.pricing : await this.money.pricing(q);
      pricing = priceSimulation(config, { accountId: input.accountId, type: input.type, amount: input.amount, at: input.completedAt });
      if (!input.claimed || input.claimed.tokenCost !== pricing.tokenCost) {
        return { ok: false, code: 'PRICING_MISMATCH', message: `This simulation costs ${pricing.tokenCost} tokens, the device priced it at ${input.claimed?.tokenCost ?? '?'}` };
      }
      cost = pricing.tokenCost;
      split = tokenSplit({ paymentMethod: input.method, centralTokens: input.central, pricing });
      if (split.device > 0) {
        if (!alloc) return { ok: false, code: 'INSUFFICIENT_TOKENS', message: 'This device has no tokens set aside' };
        if (Date.parse(input.completedAt) > Date.parse(iso(alloc.authorization_expires_at))) {
          return { ok: false, code: 'AUTHORIZATION_EXPIRED', message: 'Spent after the offline authorization ended' };
        }
        if (unusedNow < split.device) return { ok: false, code: 'INSUFFICIENT_TOKENS', message: `Needs ${split.device} tokens from this device; ${unusedNow} left set aside` };
      }
    }
    if (cost === 0) return { ok: true };

    // Plan both parts first.
    const centralPlan = split.central > 0 ? planDeduction(await this.money.lots(q, walletId), split.central, this.now()) : null;
    if (centralPlan && !centralPlan.ok) {
      return { ok: false, code: 'INSUFFICIENT_TOKENS', message: `Needs ${split.central} tokens from the central balance; ${centralPlan.available} available` };
    }
    let phonePlan: ReturnType<typeof planAllocationSpend> | null = null;
    if (split.device > 0) {
      const lots = await q.query<{ lot_id: string; category: TokenCategory; quantity: number; spent: number; created_at: Date; expires_at: Date | null }>(
        `SELECT al.lot_id, al.category, al.quantity, al.spent, l.created_at, l.expires_at
         FROM allocation_lots al JOIN token_lots l ON l.id = al.lot_id WHERE al.allocation_id = $1`,
        [alloc!.id],
      );
      phonePlan = planAllocationSpend(
        lots.map((l) => ({ lotId: l.lot_id, category: l.category, quantity: Number(l.quantity), spent: Number(l.spent), createdAt: iso(l.created_at), expiresAt: l.expires_at ? iso(l.expires_at) : null })),
        split.device,
      );
      if (!phonePlan.ok) return { ok: false, code: 'INSUFFICIENT_TOKENS', message: `Needs ${split.device} tokens from this device; ${phonePlan.available} left set aside` };
    }

    if (phonePlan?.ok) {
      for (const d of phonePlan.deductions) {
        await q.query('UPDATE token_lots SET remaining_quantity = remaining_quantity - $2, reserved_quantity = reserved_quantity - $2 WHERE id = $1', [d.lotId, d.quantity]);
        await q.query('UPDATE allocation_lots SET spent = spent + $3 WHERE allocation_id = $1 AND lot_id = $2', [alloc!.id, d.lotId, d.quantity]);
        await this.money.ledgerLine(q, {
          walletId, entryType: 'SIMULATION_EXPENDITURE', category: d.category, quantity: d.quantity, direction: 'DEBIT', referenceType: 'SIMULATION',
          referenceId: input.simulationId, lotId: d.lotId, deviceId: input.deviceId, expiresAt: null, metadata: { allocationId: alloc!.id },
        });
      }
      await q.query('UPDATE device_allocations SET spent_quantity = spent_quantity + $2 WHERE id = $1', [alloc!.id, split.device]);
    }
    if (centralPlan?.ok) {
      for (const d of centralPlan.deductions) {
        await q.query('UPDATE token_lots SET remaining_quantity = remaining_quantity - $2 WHERE id = $1', [d.lotId, d.quantity]);
        await this.money.ledgerLine(q, {
          walletId, entryType: 'SIMULATION_EXPENDITURE', category: d.category, quantity: d.quantity, direction: 'DEBIT', referenceType: 'SIMULATION',
          referenceId: input.simulationId, lotId: d.lotId, deviceId: input.deviceId, expiresAt: null, metadata: null,
        });
      }
    }
    await q.query("INSERT INTO token_spends (wallet_id, simulation_id, quantity, pricing, status, created_at, allocation_id) VALUES ($1, $2, $3, $4, 'SPENT', $5, $6)", [
      walletId, input.simulationId, cost, JSON.stringify(pricing), this.now(), split.device > 0 ? alloc!.id : null,
    ]);
    await this.money.refreshCaches(q, walletId);
    return { ok: true };
  }

  /**
   * Returns the device's unused tokens to the central balance (§29.2). Refused unless the device has uploaded
   * all its token-funded simulations: what it says it has left must equal what the server has left.
   */
  async release(deviceId: string, deviceRemaining: number): Promise<{ released: number }> {
    return this.db.transaction(async (q) => {
      const accountId = await this.accountOf(q, deviceId);
      const walletId = await this.money.lockWallet(q, accountId);
      const alloc = await this.active(q, deviceId, true);
      if (!alloc) return { released: 0 };
      // A device whose account moved elsewhere had its later uploads refused (never charged): everything
      // the server still holds for it goes back.
      const [moved] = await q.query<{ x: number }>(
        'SELECT 1 AS x FROM installations i JOIN accounts a ON a.id = i.account_id WHERE i.id = $1 AND i.signed_out_at IS NOT NULL AND a.installation_id IS DISTINCT FROM i.id',
        [deviceId],
      );
      if (!moved && deviceRemaining !== unused(alloc)) {
        throw new MonetizationError('INVALID_STATE', 'This phone still has token spending to upload. Sync first, then release.');
      }
      const released = await this.settleUnused(q, alloc, walletId, 'DEVICE_RELEASE', null);
      await q.query("UPDATE device_allocations SET status = 'RELEASED', released_quantity = released_quantity + $2, released_at = $3 WHERE id = $1", [alloc.id, released, this.now()]);
      await this.money.refreshCaches(q, walletId);
      return { released };
    });
  }

  /**
   * A permanently lost device (§29.5): its unreconciled reserved tokens are forfeited as a permanent ledger
   * event — never assumed unused, never explained with invented transactions. Audited.
   */
  async forfeitLostDevice(deviceId: string, actor: string, reason: string): Promise<{ forfeited: number }> {
    return this.db.transaction(async (q) => {
      const [acct] = await q.query<{ id: string }>('SELECT i.account_id AS id FROM installations i WHERE i.id = $1 AND i.account_id IS NOT NULL', [deviceId]);
      await q.query("UPDATE installations SET status = 'LOST' WHERE id = $1", [deviceId]);
      let forfeited = 0;
      if (acct) {
        const walletId = await this.money.lockWallet(q, acct.id);
        const alloc = await this.active(q, deviceId, true);
        if (alloc) {
          forfeited = await this.settleUnused(q, alloc, walletId, 'LOST_DEVICE_FORFEITURE', reason);
          await q.query("UPDATE device_allocations SET status = 'FORFEITED', forfeited_quantity = forfeited_quantity + $2, released_at = $3 WHERE id = $1", [alloc.id, forfeited, this.now()]);
        }
        await this.money.refreshCaches(q, walletId);
      }
      await q.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6)', [
        actor, 'FORFEIT_LOST_DEVICE', 'DEVICE', deviceId, JSON.stringify({ forfeited }), reason,
      ]);
      return { forfeited };
    });
  }

  /** Unreserves each lot's unused part: back to the wallet (release) or removed for good (forfeiture). */
  private async settleUnused(q: Queryable, alloc: AllocationRow, walletId: string, type: 'DEVICE_RELEASE' | 'LOST_DEVICE_FORFEITURE', reason: string | null): Promise<number> {
    const lots = await q.query<{ lot_id: string; category: TokenCategory; quantity: number; spent: number }>(
      'SELECT lot_id, category, quantity, spent FROM allocation_lots WHERE allocation_id = $1',
      [alloc.id],
    );
    let total = 0;
    for (const l of lots) {
      const left = Number(l.quantity) - Number(l.spent);
      if (left <= 0) continue;
      const removes = type === 'LOST_DEVICE_FORFEITURE';
      await q.query(
        `UPDATE token_lots SET reserved_quantity = reserved_quantity - $2${removes ? ', remaining_quantity = remaining_quantity - $2' : ''} WHERE id = $1`,
        [l.lot_id, left],
      );
      await q.query('UPDATE allocation_lots SET quantity = spent WHERE allocation_id = $1 AND lot_id = $2', [alloc.id, l.lot_id]);
      await this.money.ledgerLine(q, {
        walletId, entryType: type, category: l.category, quantity: left, direction: removes ? 'DEBIT' : 'CREDIT', referenceType: 'DEVICE',
        referenceId: alloc.id, lotId: l.lot_id, deviceId: alloc.device_id, expiresAt: null, metadata: reason ? { reason } : null,
      });
      total += left;
    }
    return total;
  }
}
