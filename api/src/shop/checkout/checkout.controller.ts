import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { IDEMPOTENCY_KEY_PATTERN } from '../../orders/dto/orders.dto';
import { CurrentCustomer } from '../customers/current-customer.decorator';
import { CustomerGuard } from '../customers/customer.guard';
import type { CustomerPrincipal } from '../customers/customers.service';
import { CreateWebOrderDto } from '../dto/shop.dto';
import { CheckoutService } from './checkout.service';
import type { WebOrderView } from './web-order.view';

/** A customer's own orders. Cookie-authenticated; mutations need the CSRF header (checked by the guard). */
@ApiTags('shop')
@ApiCookieAuth('wc_cst')
@Public()
@UseGuards(CustomerGuard)
@Controller('shop/orders')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /** 201 for a new order; 200 when the Idempotency-Key was already used (the original order is returned). */
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: '8–80 chars [A-Za-z0-9_-]; one per checkout attempt' })
  @Audit('shop.order.create', { entity: 'Order' })
  @Post()
  @HttpCode(201)
  async create(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body() dto: CreateWebOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebOrderView & { replayed: boolean }> {
    if (key !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'BAD_IDEMPOTENCY_KEY', message: 'Invalid Idempotency-Key header.' });
    }
    const { order, replayed } = await this.checkout.createOrder(customer, dto, key);
    if (replayed) res.status(200);
    return { ...order, replayed };
  }

  @Get(':id')
  get(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<WebOrderView> {
    return this.checkout.get(customer, id);
  }

  @Audit('shop.order.cancel', { entity: 'Order', idParam: 'id' })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<WebOrderView> {
    return this.checkout.cancelUnpaid(customer, id);
  }
}
