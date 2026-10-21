import { Module } from '@nestjs/common';
import { CheckoutExpiryService } from './checkout/checkout-expiry.service';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { CustomerGuard } from './customers/customer.guard';
import { CustomersService } from './customers/customers.service';
import { OtpService } from './customers/otp.service';
import { ShopAuthController } from './customers/shop-auth.controller';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsModule } from './payments/payments.module';
import { ConsoleSmsSender, SMS_SENDER } from './sms/sms-sender';

/** The website's online checkout: customer sign-in, orders, payments. */
@Module({
  imports: [PaymentsModule],
  controllers: [ShopAuthController, CheckoutController, PaymentsController],
  providers: [CustomersService, OtpService, CustomerGuard, CheckoutService, CheckoutExpiryService, { provide: SMS_SENDER, useClass: ConsoleSmsSender }],
  exports: [CustomersService, CustomerGuard],
})
export class ShopModule {}
