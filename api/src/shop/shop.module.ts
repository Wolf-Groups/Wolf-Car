import { Module } from '@nestjs/common';
import { CheckoutExpiryService } from './checkout/checkout-expiry.service';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { CustomerCarsService } from './customers/customer-cars.service';
import { CustomerGuard } from './customers/customer.guard';
import { CustomersService } from './customers/customers.service';
import { OptionalCustomerGuard } from './customers/optional-customer.guard';
import { OtpService } from './customers/otp.service';
import { ShopAuthController } from './customers/shop-auth.controller';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsModule } from './payments/payments.module';

/** The website's online checkout: customer sign-in by email, orders, payments. EMAIL_SENDER comes from the global EmailModule. */
@Module({
  imports: [PaymentsModule],
  controllers: [ShopAuthController, CheckoutController, PaymentsController],
  providers: [CustomersService, CustomerCarsService, OtpService, CustomerGuard, OptionalCustomerGuard, CheckoutService, CheckoutExpiryService],
  exports: [CustomersService, CustomerGuard, OptionalCustomerGuard],
})
export class ShopModule {}
