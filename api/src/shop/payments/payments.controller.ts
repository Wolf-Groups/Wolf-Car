import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { WebOrderView } from '../checkout/web-order.view';
import type { OrderAccess } from '../checkout/order-access';
import { CurrentOrderAccess, OptionalCustomerGuard } from '../customers/optional-customer.guard';
import { PayDto } from '../dto/shop.dto';
import { PaymentsService } from './payments.service';

/** Paying for a web order, and Tap's webhook. */
@ApiTags('shop')
@Public()
@Controller('shop')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** The signed-in customer's order, or any order with its X-Order-Key. */
  @ApiCookieAuth('wc_cst')
  @UseGuards(OptionalCustomerGuard)
  @Audit('shop.order.pay', { entity: 'Order', idParam: 'id' })
  @Post('orders/:id/pay')
  @HttpCode(200)
  pay(@CurrentOrderAccess() access: OrderAccess, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto): Promise<{ redirectUrl: string | null; order: WebOrderView }> {
    return this.payments.pay(access, id, dto);
  }

  @ApiCookieAuth('wc_cst')
  @UseGuards(OptionalCustomerGuard)
  @Audit('shop.order.reconcile', { entity: 'Order', idParam: 'id' })
  @Post('orders/:id/reconcile')
  @HttpCode(200)
  reconcile(@CurrentOrderAccess() access: OrderAccess, @Param('id', ParseUUIDPipe) id: string): Promise<WebOrderView> {
    return this.payments.reconcile(access, id);
  }

  /** Tap posts the charge here. No cookie: the hashstring header is the proof. */
  @Audit('shop.payment.webhook', { entity: 'Order' })
  @Post('payments/tap/webhook')
  @HttpCode(200)
  webhook(@Body() body: unknown, @Headers('hashstring') hashstring: string | string[] | undefined): Promise<{ received: true }> {
    return this.payments.handleWebhook(body, hashstring);
  }
}
