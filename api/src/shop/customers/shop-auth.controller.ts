import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuditTrail } from '../../activity/audit-trail.service';
import { clearCustomerCookie, setCustomerCookie } from '../../auth/cookies';
import { TokenService } from '../../auth/token.service';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthThrottle } from '../../common/decorators/auth-throttle.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env';
import { SendOtpDto, VerifyOtpDto } from '../dto/shop.dto';
import { CsrfGuard } from './csrf.guard';
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
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
    private readonly trail: AuditTrail,
  ) {}

  private get secure(): boolean {
    return this.config.get('COOKIE_SECURE', { infer: true });
  }

  /** Before sign-in the activity log names the phone the visitor typed. */
  private actAs(phone: string): void {
    this.trail.setActor({ id: null, username: phone, role: null, branchId: null });
  }

  /** Sends a code. Same answer whether or not the phone is known. */
  @UseGuards(CsrfGuard)
  @AuthThrottle()
  @Audit('shop.otp.send', { entity: 'Customer' })
  @Post('otp')
  @HttpCode(200)
  sendOtp(@Body() dto: SendOtpDto): Promise<{ expiresAt: Date; devCode?: string }> {
    this.actAs(dto.phone);
    return this.otp.issue(dto.phone);
  }

  /** Sets the httpOnly wc_cst cookie (path /api/shop) and the readable wc_customer hint. */
  @UseGuards(CsrfGuard)
  @AuthThrottle()
  @Audit('shop.otp.verify', { entity: 'Customer' })
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response): Promise<{ customer: CustomerProfileView; expiresAt: Date }> {
    this.actAs(dto.phone);
    const { customer, created } = await this.otp.verify(dto.phone, dto.code);
    this.trail.setEntity('Customer', customer.id).addMetadata({ created });
    const { token, expiresAt } = await this.tokens.signCustomer(customer.id, customer.sessionVersion);
    setCustomerCookie(res, token, expiresAt, this.secure);
    return { customer: { phone: customer.phone, name: customer.name, email: customer.email }, expiresAt };
  }

  @ApiCookieAuth('wc_cst')
  @UseGuards(CustomerGuard)
  @Get('me')
  me(@CurrentCustomer() customer: CustomerPrincipal): Promise<CustomerProfileView> {
    return this.customers.profile(customer.id);
  }

  /** Signs this device out; the token itself stays valid until logout-all. */
  @ApiCookieAuth('wc_cst')
  @UseGuards(CustomerGuard)
  @Audit('shop.logout', { entity: 'Customer' })
  @Post('logout')
  @HttpCode(204)
  logout(@CurrentCustomer() customer: CustomerPrincipal, @Res({ passthrough: true }) res: Response): void {
    this.trail.setEntity('Customer', customer.id);
    clearCustomerCookie(res, this.secure);
  }

  @ApiCookieAuth('wc_cst')
  @UseGuards(CustomerGuard)
  @Audit('shop.logout_all', { entity: 'Customer' })
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentCustomer() customer: CustomerPrincipal, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.trail.setEntity('Customer', customer.id);
    await this.customers.logoutAll(customer.id);
    clearCustomerCookie(res, this.secure);
  }
}
