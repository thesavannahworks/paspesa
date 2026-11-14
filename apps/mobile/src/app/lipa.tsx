import { PaymentJourneyScreen } from '@/components/payments';

/** Lipa na M-PESA (reference-screenshots/05-buy-goods, 06-paybill; Pochi shares the layout, White Paper §12.3). */
export default function LipaScreen() {
  return <PaymentJourneyScreen title="Lipa na M-PESA" types={['BUY_GOODS', 'PAYBILL', 'POCHI']} lowercaseLabels />;
}
