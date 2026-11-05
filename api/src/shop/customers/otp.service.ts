import { randomInt, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '../../../../shared/shop';
import { sha256Hex } from '../../common/crypto';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_SENDER, EmailSendError, type EmailSender } from '../../email/email-sender';
import { signInCodeEmail } from '../emails/sign-in-code.email';
import { CUSTOMER_PRINCIPAL_SELECT, type CustomerPrincipal } from './customers.service';

/** OTP_PER_EMAIL_PER_15_MIN counts the codes of this window. */
const SEND_WINDOW_MS = 15 * 60_000;

const otpHash = (code: string, email: string) => sha256Hex(`${code}:${email}`);

function sameHash(storedHex: string, givenHex: string): boolean {
  const stored = Buffer.from(storedHex, 'hex');
  const given = Buffer.from(givenHex, 'hex');
  return stored.length === given.length && timingSafeEqual(stored, given);
}

const signInUnavailable = () =>
  new ServiceUnavailableException({ statusCode: 503, error: 'Service Unavailable', code: 'SIGN_IN_UNAVAILABLE', message: 'Sign-in is not available right now.' });

const otpInvalid = () =>
  new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'OTP_INVALID', message: 'Wrong or expired code.' });

/**
 * Sign-in codes, sent by email. `issue` stores sha256Hex(code + ':' + email)
 * with a 5-minute expiry and emails the code; at most OTP_PER_EMAIL_PER_15_MIN
 * codes per address (429 OTP_TOO_MANY with retryAfterSeconds). A production API
 * without a real sender (EMAIL_PROVIDER=console) answers 503 SIGN_IN_UNAVAILABLE
 * instead of writing codes to the log. `verify` claims one of
 * OTP_MAX_ATTEMPTS guesses with a conditional update before comparing, so a
 * burst of parallel guesses cannot try more than the limit; a right code
 * consumes the row and finds or creates the customer.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly mailer: EmailSender,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * `devCode` only with the console sender outside production (or OTP_DEV_CODE_IN_RESPONSE). An email Brevo
   * refuses (its daily limit, an outage) is 503 SIGN_IN_UNAVAILABLE, and that code no longer counts against the limit.
   */
  async issue(email: string, locale: 'ar' | 'en'): Promise<{ expiresAt: Date; devCode?: string }> {
    if (!this.canSend()) throw signInUnavailable();
    const code = String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');
    const now = Date.now();
    const since = new Date(now - SEND_WINDOW_MS);
    const limit = this.config.get('OTP_PER_EMAIL_PER_15_MIN', { infer: true });
    const expiresAt = new Date(now + OTP_TTL_SECONDS * 1000);

    const otp = await this.prisma.$transaction(async (tx) => {
      // one issue per address at a time, so a burst of requests cannot all pass the count
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`otp-email:${email}`}))`;
      const recent = await tx.customerOtp.count({ where: { email, createdAt: { gte: since } } });
      if (recent >= limit) {
        // there is room again once the code that keeps the window full is 15 minutes old
        const blocking = await tx.customerOtp.findFirst({
          where: { email, createdAt: { gte: since } },
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
            message: 'Too many codes for this address. Try again later.',
            retryAfterSeconds: Math.min(SEND_WINDOW_MS / 1000, Math.max(1, Math.ceil(wait / 1000))),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return tx.customerOtp.create({ data: { email, codeHash: otpHash(code, email), expiresAt }, select: { id: true } });
    });

    try {
      await this.mailer.send({ to: [email], ...signInCodeEmail(code, locale) });
    } catch (err) {
      if (!(err instanceof EmailSendError)) throw err;
      this.logger.warn(`Sign-in code not sent: Brevo answered ${err.code}`);
      // never reached the customer: it must not use up one of their codes for the next 15 minutes
      try {
        await this.prisma.customerOtp.delete({ where: { id: otp.id } });
      } catch {
        /* it expires in 5 minutes anyway */
      }
      throw signInUnavailable();
    }
    return this.showsCode() ? { expiresAt, devCode: code } : { expiresAt };
  }

  /** 401 OTP_INVALID for a wrong, expired, consumed or over-tried code. */
  async verify(email: string, code: string): Promise<{ customer: CustomerPrincipal; created: boolean }> {
    const now = new Date();
    const row = await this.prisma.customerOtp.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true },
    });
    if (!row) throw otpInvalid();

    const claimed = await this.prisma.customerOtp.updateMany({
      where: { id: row.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0 || !sameHash(row.codeHash, otpHash(code, email))) throw otpInvalid();

    return this.prisma.$transaction(async (tx) => {
      await tx.customerOtp.update({ where: { id: row.id }, data: { consumedAt: now } });
      const existing = await tx.customer.findUnique({ where: { email }, select: { id: true } });
      const customer = await tx.customer.upsert({
        where: { email },
        create: { email, lastLoginAt: now },
        update: { lastLoginAt: now },
        select: CUSTOMER_PRINCIPAL_SELECT,
      });
      return { customer: { ...customer, email }, created: existing === null };
    });
  }

  /** The console sender only writes to the log: in production that is no way to reach a customer (the browser tests excepted). */
  private canSend(): boolean {
    return (
      this.config.get('EMAIL_PROVIDER', { infer: true }) !== 'console' ||
      this.config.get('NODE_ENV', { infer: true }) !== 'production' ||
      this.config.get('ALLOW_TEST_CHECKOUT', { infer: true })
    );
  }

  private showsCode(): boolean {
    return (
      this.config.get('EMAIL_PROVIDER', { infer: true }) === 'console' &&
      (this.config.get('NODE_ENV', { infer: true }) !== 'production' || this.config.get('OTP_DEV_CODE_IN_RESPONSE', { infer: true }))
    );
  }
}
