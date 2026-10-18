import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuditTrail } from '../../activity/audit-trail.service';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthThrottle } from '../../common/decorators/auth-throttle.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env';
import { SendOtpDto, VerifyOtpDto } from '../dto/shop.dto';
import { todo } from '../todo';
import { CurrentCustomer } from './current-customer.decorator';
import { CustomerGuard } from './customer.guard';
import { CustomersService, type CustomerPrincipal, type CustomerProfileView } from './customers.service';
import { OtpService } from './otp.service';

/**
 * The website customer's sign-in. There is no staff user here: the routes are
 * public to the global JWT guard and, once signed in, protected by the
 * customer cookie (CustomerGuard).
 */
@ApiTags('shop')
@Public()
@Controller('shop')
export class ShopAuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly customers: CustomersService,
    private readonly config: ConfigService<Env, true>,
    private readonly trail: AuditTrail,
  ) {}

  /** Sends a code. Same answer whether or not the phone is known. */
  @AuthThrottle()
  @Audit('shop.otp.send', { entity: 'Customer' })
  @Post('otp')
  @HttpCode(200)
  sendOtp(@Body() dto: SendOtpDto): Promise<{ expiresAt: Date; devCode?: string }> {
    return todo('ShopAuthController.sendOtp', this.otp, dto);
  }

  /** Sets the httpOnly wc_cst cookie (path /api/shop) and the readable wc_customer hint. */
  @AuthThrottle()
  @Audit('shop.otp.verify', { entity: 'Customer' })
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response): Promise<{ customer: CustomerProfileView; expiresAt: Date }> {
    return todo('ShopAuthController.verifyOtp', this.customers, this.config, this.trail, dto, res);
  }

  @ApiCookieAuth('wc_cst')
  @UseGuards(CustomerGuard)
  @Get('me')
  me(@CurrentCustomer() customer: CustomerPrincipal): Promise<CustomerProfileView> {
    return todo('ShopAuthController.me', customer);
  }

  @ApiCookieAuth('wc_cst')
  @UseGuards(CustomerGuard)
  @Audit('shop.logout', { entity: 'Customer' })
  @Post('logout')
  @HttpCode(204)
  logout(@CurrentCustomer() customer: CustomerPrincipal, @Res({ passthrough: true }) res: Response): Promise<void> {
    return todo('ShopAuthController.logout', customer, res);
  }

  @ApiCookieAuth('wc_cst')
  @UseGuards(CustomerGuard)
  @Audit('shop.logout_all', { entity: 'Customer' })
  @Post('logout-all')
  @HttpCode(204)
  logoutAll(@CurrentCustomer() customer: CustomerPrincipal, @Res({ passthrough: true }) res: Response): Promise<void> {
    return todo('ShopAuthController.logoutAll', customer, res);
  }
}
