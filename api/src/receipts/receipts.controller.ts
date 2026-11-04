import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types';
import type { ReceiptLocale } from './receipt-template';
import { ReceiptsService } from './receipts.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  /** PDF receipt (branch, order number, date, customer, lines with qty/unit/line totals, grand total). */
  @ApiProduces('application/pdf')
  @ApiQuery({ name: 'locale', enum: ['ar', 'en'], required: false })
  @RequireAnyPermission('order.receipt.download', 'order.web.handle')
  @Audit('order.receipt.download', { entity: 'Order', idParam: 'id' })
  @Get(':id/receipt')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const lang: ReceiptLocale = locale === 'en' ? 'en' : 'ar';
    const { filename, pdf } = await this.receipts.receipt(user, id, lang);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: pdf.length,
    });
  }
}
