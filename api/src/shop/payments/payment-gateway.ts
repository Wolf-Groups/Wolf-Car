import type { TapCharge } from './tap-charge';

/** What the API asks a payment provider for. Amounts are "1234.50" strings. */
export interface CreateChargeInput {
  amount: string;
  currency: 'QAR';
  /** The card token from the browser SDK ("tok_…"). */
  tokenId: string;
  customer: { name: string; email: string; phone: string };
  /** Where the payer lands after 3-D Secure. */
  redirectUrl: string;
  /** Where Tap posts the webhook. */
  postUrl: string;
  orderId: string;
  orderCode: string;
  /** Our Payment row id; sent as reference.idempotent so a retried request never charges twice. */
  paymentId: string;
  description: string;
  locale: 'ar' | 'en';
}

export interface RefundInput {
  chargeId: string;
  /** What Tap captured, "100.00". */
  amount: string;
  /** The captured attempt's currency. */
  currency: string;
  reason: string;
}

export interface GatewayRefund {
  id: string;
  status: string;
}

export interface PaymentGateway {
  createCharge(input: CreateChargeInput): Promise<TapCharge>;
  getCharge(chargeId: string): Promise<TapCharge>;
  refund(input: RefundInput): Promise<GatewayRefund>;
}

/** Thrown by a gateway for anything that is not a charge object: HTTP errors, declined tokens, network. */
export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly code: string = 'GATEWAY_ERROR',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

/** DI token. Resolves to TapClient, FakePaymentGateway, or null when payments are not configured. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
