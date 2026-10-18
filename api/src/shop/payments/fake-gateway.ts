import { todo } from '../todo';
import type { CreateChargeInput, GatewayRefund, PaymentGateway, RefundInput } from './payment-gateway';
import type { TapCharge } from './tap-charge';

/**
 * In-memory stand-in for Tap (PAYMENTS_PROVIDER=fake): local development
 * without an account, the API e2e suite and the browser tests. The token
 * decides the outcome (shared/shop.ts FAKE_TOKENS): tok_fake_ok captures on
 * the first getCharge, tok_fake_declined declines, tok_fake_pending stays
 * INITIATED; any other token is refused at createCharge (INVALID_TOKEN).
 * The charge's transaction.url is the redirect URL itself, so a browser lands
 * straight on the return page.
 */
export class FakePaymentGateway implements PaymentGateway {
  private readonly charges = new Map<string, { charge: TapCharge; tokenId: string }>();
  private counter = 0;

  createCharge(input: CreateChargeInput): Promise<TapCharge> {
    return todo('FakePaymentGateway.createCharge', this.charges, this.counter, input);
  }

  getCharge(chargeId: string): Promise<TapCharge> {
    return todo('FakePaymentGateway.getCharge', chargeId);
  }

  refund(input: RefundInput): Promise<GatewayRefund> {
    return todo('FakePaymentGateway.refund', input);
  }

  /** Tests: force a status ("CAPTURED", "DECLINED", …) and get the charge back. */
  settle(chargeId: string, status: string): TapCharge {
    return todo('FakePaymentGateway.settle', chargeId, status);
  }
}
