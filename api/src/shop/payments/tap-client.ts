import { localQatarNumber } from '../../../../shared/shop';
import {
  type CreateChargeInput,
  type GatewayRefund,
  type PaymentGateway,
  PaymentGatewayError,
  type RefundInput,
} from './payment-gateway';
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

  /** POST {apiUrl}/charges */
  createCharge(input: CreateChargeInput): Promise<TapCharge> {
    const [firstName, ...rest] = input.customer.name.trim().split(' ');
    return this.call<TapCharge>(
      'POST',
      '/charges',
      {
        amount: Number(input.amount),
        currency: input.currency,
        threeDSecure: true,
        save_card: false,
        description: input.description,
        metadata: { orderId: input.orderId, paymentId: input.paymentId },
        reference: { order: input.orderCode, idempotent: input.paymentId },
        customer: {
          first_name: firstName,
          last_name: rest.join(' '),
          email: input.customer.email,
          phone: { country_code: '974', number: localQatarNumber(input.customer.phone) },
        },
        source: { id: input.tokenId },
        redirect: { url: input.redirectUrl },
        post: { url: input.postUrl },
      },
      input.locale,
    );
  }

  /** GET {apiUrl}/charges/{id} */
  getCharge(chargeId: string): Promise<TapCharge> {
    return this.call<TapCharge>('GET', `/charges/${encodeURIComponent(chargeId)}`);
  }

  /** POST {apiUrl}/refunds */
  refund(input: RefundInput): Promise<GatewayRefund> {
    return this.call<GatewayRefund>('POST', '/refunds', {
      charge_id: input.chargeId,
      amount: Number(input.amount),
      currency: input.currency,
      reason: input.reason,
    });
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: object,
    locale?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.secretKey}`,
      'Content-Type': 'application/json',
    };
    if (locale) headers.lang_code = locale;

    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.apiUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new PaymentGatewayError(
        timedOut ? 'Tap request timed out' : 'Tap request failed',
        timedOut ? 'TAP_TIMEOUT' : 'TAP_NETWORK',
      );
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      const first = (
        json as { errors?: { code?: string | number; description?: string }[] } | undefined
      )?.errors?.[0];
      const message = (first?.description ?? 'Tap error').split(this.cfg.secretKey).join('***');
      throw new PaymentGatewayError(
        message,
        first?.code !== undefined ? String(first.code) : `TAP_HTTP_${res.status}`,
        res.status,
      );
    }
    if (json === undefined || json === null || typeof json !== 'object') {
      throw new PaymentGatewayError('Tap error', 'TAP_BAD_RESPONSE', res.status);
    }
    return json as T;
  }
}
