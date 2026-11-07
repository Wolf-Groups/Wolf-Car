import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthThrottle } from '../../common/decorators/auth-throttle.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { IDEMPOTENCY_KEY_PATTERN } from '../../orders/dto/orders.dto';
import { CurrentCustomer } from '../customers/current-customer.decorator';
import { CustomerGuard } from '../customers/customer.guard';
import type { CustomerPrincipal } from '../customers/customers.service';
import { CurrentOrderAccess, OptionalCustomerGuard } from '../customers/optional-customer.guard';
import { CreateWebOrderDto } from '../dto/shop.dto';
import { type CreatedWebOrder, CheckoutService } from './checkout.service';
import type { OrderAccess } from './order-access';
import type { WebOrderView } from './web-order.view';

const ORDER_KEY_HEADER = { name: 'X-Order-Key', required: false, description: "The order's key (from its creation or an order email); opens it without a session" };

/**
 * Web orders, for signed-in customers (cookie) and guests (the order's key).
 * Mutations need the CSRF header (checked by the guards).
 */
@ApiTags('shop')
@ApiCookieAuth('wc_cst')
@Public()
@Controller('shop/orders')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /** 201 for a new order; 200 when the Idempotency-Key was already used (the original order is returned). No sign-in needed. */
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: '8–80 chars [A-Za-z0-9_-]; one per checkout attempt' })
  @UseGuards(OptionalCustomerGuard)
  @AuthThrottle()
  @Audit('shop.order.create', { entity: 'Order' })
  @Post()
  @HttpCode(201)
  async create(
    @CurrentOrderAccess() access: OrderAccess,
    @Body() dto: CreateWebOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreatedWebOrder & { replayed: boolean }> {
    if (key !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'BAD_IDEMPOTENCY_KEY', message: 'Invalid Idempotency-Key header.' });
    }
    const { order, replayed } = await this.checkout.createOrder(access, dto, key);
    if (replayed) res.status(200);
    return { ...order, replayed };
  }

  /** The signed-in customer's orders (also those placed as a guest with their email), newest first, at most 50; abandoned checkouts are left out. */
  @UseGuards(CustomerGuard)
  @Get()
  list(@CurrentCustomer() customer: CustomerPrincipal): Promise<WebOrderView[]> {
    return this.checkout.list(customer);
  }

  @ApiHeader(ORDER_KEY_HEADER)
  @UseGuards(OptionalCustomerGuard)
  @Get(':id')
  get(@CurrentOrderAccess() access: OrderAccess, @Param('id', ParseUUIDPipe) id: string): Promise<WebOrderView> {
    return this.checkout.get(access, id);
  }

  @ApiHeader(ORDER_KEY_HEADER)
  @UseGuards(OptionalCustomerGuard)
  @Audit('shop.order.cancel', { entity: 'Order', idParam: 'id' })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentOrderAccess() access: OrderAccess, @Param('id', ParseUUIDPipe) id: string): Promise<WebOrderView> {
    return this.checkout.cancelUnpaid(access, id);
  }
}
