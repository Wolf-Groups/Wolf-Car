import { Module } from '@nestjs/common';
import { OdooModule } from '../odoo/odoo.module';
import { PaymentsModule } from '../shop/payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PaymentsModule, OdooModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
