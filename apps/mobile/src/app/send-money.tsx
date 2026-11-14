import { PaymentJourneyScreen } from '@/components/payments';

/** Send Money (reference-screenshots/03-send-money, 04-pochi-la-biashara). */
export default function SendMoneyScreen() {
  return <PaymentJourneyScreen title="Send Money" types={['SEND_MONEY', 'POCHI']} />;
}
