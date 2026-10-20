import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { FakePaymentGateway } from './fake-gateway';
import { paymentGatewayFactory } from './payments.module';
import { TapClient } from './tap-client';

const configWith = (values: Partial<Env>) => ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

describe('paymentGatewayFactory', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds the fake gateway for PAYMENTS_PROVIDER=fake', () => {
    expect(paymentGatewayFactory(configWith({ PAYMENTS_PROVIDER: 'fake' }))).toBeInstanceOf(FakePaymentGateway);
  });

  it('builds no gateway without a Tap secret key', () => {
    expect(paymentGatewayFactory(configWith({ PAYMENTS_PROVIDER: 'tap', TAP_API_URL: 'https://api.tap.company/v2' }))).toBeNull();
  });

  it.each(['https://api.tap.company/v2', 'https://api.tap.company/v2/', 'https://api.tap.company/v2//'])(
    'calls Tap without a double slash when TAP_API_URL is %s',
    async (apiUrl) => {
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ id: 'chg_1', status: 'CAPTURED', amount: 1, currency: 'QAR' }), { status: 200 }));
      const gateway = paymentGatewayFactory(configWith({ PAYMENTS_PROVIDER: 'tap', TAP_API_URL: apiUrl, TAP_SECRET_KEY: 'sk_test_x' }));
      expect(gateway).toBeInstanceOf(TapClient);
      await gateway!.getCharge('chg_1');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.tap.company/v2/charges/chg_1');
    },
  );
});
