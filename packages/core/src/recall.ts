/**
 * Name recall for transaction forms. Paspesa has no real recipient/merchant lookup (White Paper §12.3:
 * never claim to verify a real party), so names are entered by the user. When the user types an
 * identifier they have used before, the name they entered last time is offered again, taken only
 * from their own local ledger and favourites.
 */
import { normalizeKenyanPhone } from './phone';
import type { CounterpartyInput } from './catalogue';
import type { Favourite, SimulationType, TransactionRecord } from './types';

export interface RecalledNames {
  /** Recipient (Send Money / Pochi) or merchant (Buy Goods) name. */
  name?: string;
  /** Paybill business name. */
  businessName?: string;
  /** Paybill account name. */
  accountName?: string;
}

interface Party {
  type: SimulationType;
  counterparty: TransactionRecord['counterparty'];
}

export function recallNames(
  type: SimulationType,
  input: CounterpartyInput,
  transactions: readonly TransactionRecord[],
  favourites: readonly Favourite[],
): RecalledNames {
  // Most recent first: manual favourites are an explicit choice, then the ledger newest → oldest.
  const parties: Party[] = [
    ...favourites.map((f) => ({ type: f.type, counterparty: f.counterparty })),
    ...[...transactions]
      .filter((t) => t.status === 'SUCCESSFUL')
      .sort((a, b) => b.sequence - a.sequence)
      .map((t) => ({ type: t.type as SimulationType, counterparty: t.counterparty })),
  ];

  switch (type) {
    case 'SEND_MONEY':
    case 'POCHI': {
      const phone = input.phone ? normalizeKenyanPhone(input.phone) : null;
      if (!phone) return {};
      // Same journey first, then the sibling one (the same person can be paid either way).
      const sibling: SimulationType = type === 'SEND_MONEY' ? 'POCHI' : 'SEND_MONEY';
      const match =
        parties.find((p) => p.type === type && p.counterparty.phone === phone && p.counterparty.name) ??
        parties.find((p) => p.type === sibling && p.counterparty.phone === phone && p.counterparty.name);
      return match ? { name: match.counterparty.name } : {};
    }
    case 'BUY_GOODS': {
      const till = (input.tillNumber ?? '').replace(/\s+/g, '');
      if (!till) return {};
      const match = parties.find((p) => p.type === 'BUY_GOODS' && p.counterparty.tillNumber === till && p.counterparty.name);
      return match ? { name: match.counterparty.name } : {};
    }
    case 'PAYBILL': {
      const paybill = (input.paybillNumber ?? '').replace(/\s+/g, '');
      if (!paybill) return {};
      const sameBill = parties.filter((p) => p.type === 'PAYBILL' && p.counterparty.paybillNumber === paybill);
      const result: RecalledNames = {};
      const business = sameBill.find((p) => p.counterparty.businessName);
      if (business) result.businessName = business.counterparty.businessName;
      const account = (input.accountReference ?? '').trim().toUpperCase();
      if (account) {
        const acc = sameBill.find((p) => (p.counterparty.accountReference ?? '').toUpperCase() === account && p.counterparty.accountName);
        if (acc) result.accountName = acc.counterparty.accountName;
      }
      return result;
    }
    default:
      return {};
  }
}
