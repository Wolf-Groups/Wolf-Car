import { FAKE_TOKENS } from '../../../../shared/shop';
import {
  type CreateChargeInput,
  type GatewayRefund,
  type PaymentGateway,
  PaymentGatewayError,
  type RefundInput,
} from './payment-gateway';
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
    if (!(Object.values(FAKE_TOKENS) as string[]).includes(input.tokenId)) {
      return Promise.reject(new PaymentGatewayError('Unknown test token', 'INVALID_TOKEN', 400));
    }
    this.counter += 1;
    const charge: TapCharge = {
      id: `chg_fake_${this.counter}`,
      status: 'INITIATED',
      amount: Number(input.amount),
      currency: input.currency,
      // a test charge, as Tap's sandbox marks it
      live_mode: false,
      reference: { order: input.orderCode, idempotent: input.paymentId, gateway: '', payment: '' },
      transaction: { created: String(Date.now()), url: input.redirectUrl },
      metadata: { orderId: input.orderId, paymentId: input.paymentId },
    };
    this.charges.set(charge.id, { charge, tokenId: input.tokenId });
    return Promise.resolve({ ...charge });
  }

  getCharge(chargeId: string): Promise<TapCharge> {
    const entry = this.charges.get(chargeId);
    if (!entry) return Promise.reject(new PaymentGatewayError('No such charge', 'NOT_FOUND', 404));
    const { charge, tokenId } = entry;
    if (charge.status === 'INITIATED') {
      if (tokenId === FAKE_TOKENS.ok) {
        charge.status = 'CAPTURED';
        charge.reference = { ...charge.reference, payment: 'fakepay1' };
      } else if (tokenId === FAKE_TOKENS.declined) {
        charge.status = 'DECLINED';
      }
    }
    return Promise.resolve({ ...charge });
  }

  refund(input: RefundInput): Promise<GatewayRefund> {
    const entry = this.charges.get(input.chargeId);
    if (!entry || entry.charge.status !== 'CAPTURED') {
      return Promise.reject(new PaymentGatewayError('Not captured', 'NOT_CAPTURED', 400));
    }
    entry.charge.status = 'REFUNDED';
    this.counter += 1;
    return Promise.resolve({ id: `rf_fake_${this.counter}`, status: 'REFUNDED' });
  }

  /** Tests: force a status ("CAPTURED", "DECLINED", …) and get the charge back. */
  settle(chargeId: string, status: string): TapCharge {
    const entry = this.charges.get(chargeId);
    if (!entry) throw new PaymentGatewayError('No such charge', 'NOT_FOUND', 404);
    entry.charge.status = status;
    return { ...entry.charge };
  }
}
