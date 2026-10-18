import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { OdooModule } from '../../odoo/odoo.module';
import { FakePaymentGateway } from './fake-gateway';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TapClient } from './tap-client';

/**
 * The payment provider behind one token: the fake gateway when
 * PAYMENTS_PROVIDER=fake, Tap when a secret key is set, otherwise null (the
 * checkout then answers CHECKOUT_UNAVAILABLE).
 *
 * Scaffold: the factory reads settings that Task 1 adds to Env; until then it
 * resolves to null.
 */
export function paymentGatewayFactory(config: ConfigService<Env, true>): PaymentGateway | null {
  const env = config as unknown as { get(key: string): string | undefined };
  const provider = env.get('PAYMENTS_PROVIDER');
  const secret = env.get('TAP_SECRET_KEY');
  if (provider === 'fake') return new FakePaymentGateway();
  if (secret) return new TapClient({ apiUrl: env.get('TAP_API_URL') ?? 'https://api.tap.company/v2', secretKey: secret });
  return null;
}

@Module({
  imports: [OdooModule],
  controllers: [PaymentsController],
  providers: [{ provide: PAYMENT_GATEWAY, inject: [ConfigService], useFactory: paymentGatewayFactory }, PaymentsService],
  exports: [PAYMENT_GATEWAY, PaymentsService],
})
export class PaymentsModule {}
