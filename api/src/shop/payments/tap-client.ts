import { todo } from '../todo';
import type { CreateChargeInput, GatewayRefund, PaymentGateway, RefundInput } from './payment-gateway';
import type { TapCharge } from './tap-charge';

export interface TapConfig {
  /** e.g. https://api.tap.company/v2, no trailing slash */
  apiUrl: string;
  /** sk_test_… or sk_live_… */
  secretKey: string;
}

/**
 * Tap Payments Charges API. The only file that knows Tap's request shapes.
 * Non-2xx answers become PaymentGatewayError(errors[0].description, errors[0].code, status)
 * with the secret key stripped from the message. 15 s timeout per call.
 */
export class TapClient implements PaymentGateway {
  constructor(
    private readonly cfg: TapConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** POST {apiUrl}/charges — see the plan (Task 3) for the exact body. */
  createCharge(input: CreateChargeInput): Promise<TapCharge> {
    return todo('TapClient.createCharge', this.cfg, this.fetchFn, input);
  }

  /** GET {apiUrl}/charges/{id} */
  getCharge(chargeId: string): Promise<TapCharge> {
    return todo('TapClient.getCharge', chargeId);
  }

  /** POST {apiUrl}/refunds with { charge_id, amount, currency, reason } */
  refund(input: RefundInput): Promise<GatewayRefund> {
    return todo('TapClient.refund', input);
  }
}
