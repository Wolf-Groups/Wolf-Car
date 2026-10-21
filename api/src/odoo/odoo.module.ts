import { Module } from '@nestjs/common';
import { OdooController } from './odoo.controller';
import { OdooOrdersService } from './odoo-orders.service';
import { OdooSyncService } from './odoo-sync.service';

@Module({
  controllers: [OdooController],
  providers: [OdooSyncService, OdooOrdersService],
  exports: [OdooSyncService, OdooOrdersService],
})
export class OdooModule {}
