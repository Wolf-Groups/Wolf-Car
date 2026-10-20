import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { OdooModule } from '../../odoo/odoo.module';
import { FakePaymentGateway } from './fake-gateway';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway';
import { PaymentsService } from './payments.service';
import { TapClient } from './tap-client';

/**
 * The payment provider behind one token: the fake gateway when
 * PAYMENTS_PROVIDER=fake, Tap when a secret key is set, otherwise null (the
 * checkout then answers CHECKOUT_UNAVAILABLE).
 */
export function paymentGatewayFactory(config: ConfigService<Env, true>): PaymentGateway | null {
  if (config.get('PAYMENTS_PROVIDER', { infer: true }) === 'fake') return new FakePaymentGateway();
  const secretKey = config.get('TAP_SECRET_KEY', { infer: true });
  if (secretKey)
    return new TapClient({ apiUrl: config.get('TAP_API_URL', { infer: true }), secretKey });
  return null;
}

/**
 * Providers only. PaymentsController is registered in ShopModule, which
 * provides the CustomersService its CustomerGuard needs (Nest builds a
 * controller's guards inside the controller's own module).
 */
@Module({
  imports: [OdooModule],
  providers: [
    { provide: PAYMENT_GATEWAY, inject: [ConfigService], useFactory: paymentGatewayFactory },
    PaymentsService,
  ],
  exports: [PAYMENT_GATEWAY, PaymentsService],
})
export class PaymentsModule {}
