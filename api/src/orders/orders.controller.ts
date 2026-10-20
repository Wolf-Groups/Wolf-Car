import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types';
import { ListOrdersQueryDto, UpdateOrderDto } from './dto/orders.dto';
import { OrdersService } from './orders.service';

/**
 * Orders placed in the showrooms and on the website (source WEB, picked up at
 * the web-orders branch). Branch users only ever see and change their own
 * branch's orders; order.read.all lists every branch (read-only).
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequireAnyPermission('order.read.branch', 'order.read.all')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQueryDto) {
    return this.orders.list(user, query);
  }

  @RequireAnyPermission('order.read.branch', 'order.read.all')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  /** Pending orders only (Super Admin may override). */
  @RequirePermissions('order.update')
  @Audit('order.update', { entity: 'Order', idParam: 'id' })
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.update(user, id, dto);
  }

  /** Makes the order immutable (for everyone but the Super Admin). */
  @RequirePermissions('order.confirm')
  @Audit('order.confirm', { entity: 'Order', idParam: 'id' })
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.confirm(user, id);
  }

  /** A paid web order's card is refunded first (502 REFUND_FAILED leaves the order as it was). */
  @RequirePermissions('order.cancel')
  @Audit('order.cancel', { entity: 'Order', idParam: 'id' })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(user, id);
  }

  /** The cashier hands a paid web order over at the counter (once). */
  @RequirePermissions('order.confirm')
  @Audit('order.collect', { entity: 'Order', idParam: 'id' })
  @Post(':id/collect')
  @HttpCode(200)
  collect(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.collect(user, id);
  }
}
