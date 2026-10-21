import type { CreateChargeInput } from './payment-gateway';
import { PaymentGatewayError } from './payment-gateway';
import { TapClient } from './tap-client';

const cfg = { apiUrl: 'https://api.tap.company/v2', secretKey: 'sk_test_x' };

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

/** A fetch stand-in that answers each call from a queue and records the requests. */
function fakeFetch(...answers: (object | Response)[]) {
  const calls: Recorded[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      signal: init?.signal,
    });
    const next = answers.shift();
    return Promise.resolve(
      next instanceof Response ? next : new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
  return { fn, calls };
}

const input: CreateChargeInput = {
  amount: '619.50',
  currency: 'QAR',
  tokenId: 'tok_abc123',
  customer: { name: 'Sara Al Thani', email: 'sara@example.qa', phone: '+97455123456' },
  redirectUrl: 'https://wolfcar.qa/ar/checkout/return?order=o-1',
  postUrl: 'https://wolfcar.qa/api/shop/payments/tap/webhook',
  orderId: 'o-1',
  orderCode: 'BO-000001',
  paymentId: 'pay-1',
  description: 'Wolf Car order BO-000001',
  locale: 'ar',
};

const chargeAnswer = { id: 'chg_1', object: 'charge', status: 'INITIATED', amount: 619.5, currency: 'QAR', transaction: { url: 'https://tap.test/3ds' } };

describe('TapClient', () => {
  it('posts a charge in the shape Tap wants and returns the parsed charge', async () => {
    const { fn, calls } = fakeFetch(chargeAnswer);
    const charge = await new TapClient(cfg, fn).createCharge(input);
    expect(charge).toEqual(chargeAnswer);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe('https://api.tap.company/v2/charges');
    expect(call.method).toBe('POST');
    expect(call.headers.get('authorization')).toBe('Bearer sk_test_x');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.headers.get('lang_code')).toBe('ar');
    expect(call.body).toEqual({
      amount: 619.5,
      currency: 'QAR',
      threeDSecure: true,
      save_card: false,
      description: 'Wolf Car order BO-000001',
      metadata: { orderId: 'o-1', paymentId: 'pay-1' },
      reference: { order: 'BO-000001', idempotent: 'pay-1' },
      customer: { first_name: 'Sara', last_name: 'Al Thani', email: 'sara@example.qa', phone: { country_code: '974', number: '55123456' } },
      source: { id: 'tok_abc123' },
      redirect: { url: 'https://wolfcar.qa/ar/checkout/return?order=o-1' },
      post: { url: 'https://wolfcar.qa/api/shop/payments/tap/webhook' },
    });
  });

  it('sends a one-word name as first_name with an empty last_name', async () => {
    const { fn, calls } = fakeFetch(chargeAnswer);
    await new TapClient(cfg, fn).createCharge({ ...input, customer: { ...input.customer, name: 'Sara' } });
    expect((calls[0].body as { customer: { first_name: string; last_name: string } }).customer).toMatchObject({ first_name: 'Sara', last_name: '' });
  });

  it("turns Tap's error answer into a PaymentGatewayError without the secret key", async () => {
    const { fn } = fakeFetch(
      new Response(JSON.stringify({ errors: [{ code: '1125', description: 'Cannot process sk_test_x' }] }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const err = await new TapClient(cfg, fn).createCharge(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err).toMatchObject({ code: '1125', status: 400 });
    expect((err as Error).message).toContain('***');
    expect((err as Error).message).not.toContain('sk_test_x');
  });

  it("falls back to TAP_HTTP_<status> and 'Tap error' when the answer carries no errors list", async () => {
    const { fn } = fakeFetch(new Response(JSON.stringify({}), { status: 502, headers: { 'content-type': 'application/json' } }));
    const err = await new TapClient(cfg, fn).getCharge('chg_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err).toMatchObject({ code: 'TAP_HTTP_502', status: 502, message: 'Tap error' });
  });

  it('turns an answer that is not JSON (a proxy error page) into a PaymentGatewayError', async () => {
    const { fn } = fakeFetch(new Response('<html>bad gateway</html>', { status: 502 }));
    const err = await new TapClient(cfg, fn).getCharge('chg_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err).toMatchObject({ code: 'TAP_HTTP_502', status: 502 });
  });

  it('turns a network failure or timeout into a PaymentGatewayError', async () => {
    await expect(new TapClient(cfg, (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch).createCharge(input)).rejects.toBeInstanceOf(PaymentGatewayError);
    await expect(new TapClient(cfg, (() => Promise.reject(new DOMException('timed out', 'TimeoutError'))) as typeof fetch).getCharge('chg_1')).rejects.toBeInstanceOf(
      PaymentGatewayError,
    );
  });

  it('gives every call a 15 s timeout signal', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout');
    try {
      const { fn, calls } = fakeFetch(chargeAnswer, chargeAnswer, { id: 'rf_1', status: 'PENDING' });
      const client = new TapClient(cfg, fn);
      await client.createCharge(input);
      await client.getCharge('chg_1');
      await client.refund({ chargeId: 'chg_1', amount: '619.50', currency: 'QAR', reason: 'r' });
      for (const call of calls) expect(call.signal).toBeInstanceOf(AbortSignal);
      expect(spy).toHaveBeenCalledWith(15_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('reads a charge back', async () => {
    const { fn, calls } = fakeFetch({ ...chargeAnswer, status: 'CAPTURED' });
    const charge = await new TapClient(cfg, fn).getCharge('chg_1');
    expect(charge.status).toBe('CAPTURED');
    expect(calls[0]).toMatchObject({ url: 'https://api.tap.company/v2/charges/chg_1', method: 'GET' });
    expect(calls[0].headers.get('authorization')).toBe('Bearer sk_test_x');
  });

  it('refunds a charge', async () => {
    const { fn, calls } = fakeFetch({ id: 'rf_1', status: 'PENDING' });
    const refund = await new TapClient(cfg, fn).refund({ chargeId: 'chg_1', amount: '619.50', currency: 'QAR', reason: 'Cancelled by admin' });
    expect(refund).toEqual({ id: 'rf_1', status: 'PENDING' });
    expect(calls[0]).toMatchObject({ url: 'https://api.tap.company/v2/refunds', method: 'POST' });
    expect(calls[0].body).toEqual({ charge_id: 'chg_1', amount: 619.5, currency: 'QAR', reason: 'Cancelled by admin' });
  });
});
