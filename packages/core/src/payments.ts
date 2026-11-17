/**
 * Paspesa commercial payments (White Paper §30–33) — buying tokens, or paying directly for one simulation.
 * They are separate records from simulated transactions: a successful payment does not by itself mean a
 * simulation succeeded (§30).
 *
 * Payment status and simulation status are tracked separately (§33.1). Key rules:
 *  - A provider timeout is not a failure: the payment stays PENDING until its real status is verified.
 *  - Tokens are credited only from a VERIFIED successful payment, exactly once (§31).
 *  - A successful direct payment whose simulation failed technically must end REFUNDED or as
 *    REFUNDABLE_CREDIT — never silently kept (§33).
 *
 * No payment provider is connected yet: integration is a separate, controlled stage (§50 Phase 6).
 */
export type PaymentType = 'TOKEN_PURCHASE' | 'DIRECT_SIMULATION';

export type PaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCESSFUL' | 'FAILED';

/** For direct payments: the simulation waits for a verified payment before it is authorized (§32). */
export type SimulationPaymentStatus = 'NOT_APPLICABLE' | 'AWAITING_PAYMENT' | 'AUTHORIZED' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED';

export type RefundStatus = 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUNDABLE_CREDIT';

export interface PaymentRecord {
  id: string;
  ownerId: string;
  paymentType: PaymentType;
  provider: string;
  /** The provider's own reference, once known. */
  providerReference: string | null;
  /** Client-supplied key: a repeated request returns the same payment, never a second charge. */
  idempotencyKey: string;
  /** Price in whole Kenya shillings. */
  amount: number;
  currency: 'KES';
  status: PaymentStatus;
  /** TOKEN_PURCHASE: the package bought. */
  packageId: string | null;
  /** DIRECT_SIMULATION: the simulation's operation ID. */
  relatedSimulationId: string | null;
  simulationStatus: SimulationPaymentStatus;
  refundStatus: RefundStatus;
  createdAt: string;
  verifiedAt: string | null;
}

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  INITIATED: ['PENDING', 'SUCCESSFUL', 'FAILED'],
  // A timeout leaves the payment PENDING; only a verified result moves it on.
  PENDING: ['PENDING', 'SUCCESSFUL', 'FAILED'],
  SUCCESSFUL: [],
  FAILED: [],
};

const SIMULATION_TRANSITIONS: Record<SimulationPaymentStatus, SimulationPaymentStatus[]> = {
  NOT_APPLICABLE: [],
  AWAITING_PAYMENT: ['AUTHORIZED', 'FAILED'],
  AUTHORIZED: ['PROCESSING', 'SUCCESSFUL', 'FAILED'],
  PROCESSING: ['SUCCESSFUL', 'FAILED'],
  SUCCESSFUL: [],
  FAILED: [],
};

const REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  NONE: ['REFUND_PENDING', 'REFUNDABLE_CREDIT'],
  REFUND_PENDING: ['REFUNDED', 'REFUNDABLE_CREDIT'],
  REFUNDED: [],
  REFUNDABLE_CREDIT: [],
};

export const canMovePayment = (from: PaymentStatus, to: PaymentStatus) => PAYMENT_TRANSITIONS[from].includes(to);
export const canMoveSimulation = (from: SimulationPaymentStatus, to: SimulationPaymentStatus) => SIMULATION_TRANSITIONS[from].includes(to);
export const canMoveRefund = (from: RefundStatus, to: RefundStatus) => REFUND_TRANSITIONS[from].includes(to);

/** A direct payment may authorize its simulation only once the payment itself is verified successful. */
export function mayAuthorizeSimulation(p: PaymentRecord): boolean {
  return p.paymentType === 'DIRECT_SIMULATION' && p.status === 'SUCCESSFUL' && p.verifiedAt !== null && p.simulationStatus === 'AUTHORIZED';
}

/** Paid but the simulation failed and the user has not yet been made whole (§33). */
export function needsRefund(p: PaymentRecord): boolean {
  return p.paymentType === 'DIRECT_SIMULATION' && p.status === 'SUCCESSFUL' && p.simulationStatus === 'FAILED' && (p.refundStatus === 'NONE' || p.refundStatus === 'REFUND_PENDING');
}

/** A token package (§35.3). Prices are set by the product owner; none are seeded. */
export interface TokenPackage {
  id: string;
  name: string;
  tokens: number;
  /** Whole Kenya shillings. */
  price: number;
  status: 'ACTIVE' | 'INACTIVE';
}
