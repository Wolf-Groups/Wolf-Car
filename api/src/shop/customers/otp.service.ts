import { randomInt, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '../../../../shared/shop';
import { sha256Hex } from '../../common/crypto';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { otpMessage, SMS_SENDER, type SmsSender } from '../sms/sms-sender';
import { CUSTOMER_PRINCIPAL_SELECT, type CustomerPrincipal } from './customers.service';

/** OTP_PER_PHONE_PER_15_MIN counts the codes of this window. */
const SEND_WINDOW_MS = 15 * 60_000;

const otpHash = (code: string, phone: string) => sha256Hex(`${code}:${phone}`);

function sameHash(storedHex: string, givenHex: string): boolean {
  const stored = Buffer.from(storedHex, 'hex');
  const given = Buffer.from(givenHex, 'hex');
  return stored.length === given.length && timingSafeEqual(stored, given);
}

const otpInvalid = () =>
  new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'OTP_INVALID', message: 'Wrong or expired code.' });

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
  async issue(phone: string): Promise<{ expiresAt: Date; devCode?: string }> {
    const code = String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');
    const now = Date.now();
    const since = new Date(now - SEND_WINDOW_MS);
    const limit = this.config.get('OTP_PER_PHONE_PER_15_MIN', { infer: true });
    const expiresAt = new Date(now + OTP_TTL_SECONDS * 1000);

    await this.prisma.$transaction(async (tx) => {
      // one issue per phone at a time, so a burst of requests cannot all pass the count
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`otp-phone:${phone}`}))`;
      const recent = await tx.customerOtp.count({ where: { phone, createdAt: { gte: since } } });
      if (recent >= limit) {
        // there is room again once the code that keeps the window full is 15 minutes old
        const blocking = await tx.customerOtp.findFirst({
          where: { phone, createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
          skip: recent - limit,
          select: { createdAt: true },
        });
        const wait = (blocking?.createdAt.getTime() ?? now) + SEND_WINDOW_MS - now;
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            code: 'OTP_TOO_MANY',
            message: 'Too many codes for this number. Try again later.',
            retryAfterSeconds: Math.min(SEND_WINDOW_MS / 1000, Math.max(1, Math.ceil(wait / 1000))),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await tx.customerOtp.create({ data: { phone, codeHash: otpHash(code, phone), expiresAt } });
    });

    // The API does not know the visitor's language yet; the site's default is Arabic.
    await this.sms.send(phone, otpMessage(code, 'ar'));
    return this.showsCode() ? { expiresAt, devCode: code } : { expiresAt };
  }

  /** 401 OTP_INVALID for a wrong, expired, consumed or over-tried code. */
  async verify(phone: string, code: string): Promise<{ customer: CustomerPrincipal; created: boolean }> {
    const now = new Date();
    const row = await this.prisma.customerOtp.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true },
    });
    if (!row) throw otpInvalid();

    const claimed = await this.prisma.customerOtp.updateMany({
      where: { id: row.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0 || !sameHash(row.codeHash, otpHash(code, phone))) throw otpInvalid();

    return this.prisma.$transaction(async (tx) => {
      await tx.customerOtp.update({ where: { id: row.id }, data: { consumedAt: now } });
      const existing = await tx.customer.findUnique({ where: { phone }, select: { id: true } });
      const customer = await tx.customer.upsert({
        where: { phone },
        create: { phone, lastLoginAt: now },
        update: { lastLoginAt: now },
        select: CUSTOMER_PRINCIPAL_SELECT,
      });
      return { customer, created: existing === null };
    });
  }

  private showsCode(): boolean {
    return (
      this.config.get('SMS_PROVIDER', { infer: true }) === 'console' &&
      (this.config.get('NODE_ENV', { infer: true }) !== 'production' || this.config.get('OTP_DEV_CODE_IN_RESPONSE', { infer: true }))
    );
  }
}
