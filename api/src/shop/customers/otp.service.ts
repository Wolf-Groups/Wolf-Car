import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { SMS_SENDER, type SmsSender } from '../sms/sms-sender';
import { todo } from '../todo';
import type { CustomerPrincipal } from './customers.service';

/**
 * Sign-in codes. `issue` stores sha256Hex(code + ':' + phone) with a 5-minute
 * expiry and sends the text; at most OTP_PER_PHONE_PER_15_MIN codes per phone
 * (429 OTP_TOO_MANY with retryAfterSeconds). `verify` claims one of
 * OTP_MAX_ATTEMPTS guesses with a conditional update before comparing, so a
 * burst of parallel guesses cannot try more than the limit; a right code
 * consumes the row and finds or creates the customer.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** `devCode` only with the console sender outside production (or OTP_DEV_CODE_IN_RESPONSE). */
  issue(phone: string, locale: 'ar' | 'en' = 'ar'): Promise<{ expiresAt: Date; devCode?: string }> {
    return todo('OtpService.issue', this.prisma, this.sms, this.config, phone, locale);
  }

  /** 401 OTP_INVALID for a wrong, expired, consumed or over-tried code. */
  verify(phone: string, code: string): Promise<{ customer: CustomerPrincipal; created: boolean }> {
    return todo('OtpService.verify', phone, code);
  }
}
