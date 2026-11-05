// randomInt is a pass-through to the real one unless a test pins the code (zero-padding).
jest.mock('node:crypto', () => ({ ...jest.requireActual<typeof import('node:crypto')>('node:crypto'), randomInt: jest.fn() }));
import { randomInt } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mock, mockDeep } from 'jest-mock-extended';
import { OTP_MAX_ATTEMPTS } from '../../../../shared/shop';
import { sha256Hex } from '../../common/crypto';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import { EmailSendError, type EmailMessage, type EmailSender } from '../../email/email-sender';
import { OtpService } from './otp.service';

const realCrypto = jest.requireActual<typeof import('node:crypto')>('node:crypto');

const email = 'sara@example.com';
const code = '483920';

const otpRow = (over: Record<string, unknown> = {}) => ({
  id: 'otp-1',
  email,
  codeHash: sha256Hex(`${code}:${email}`),
  expiresAt: new Date(Date.now() + 200_000),
  attempts: 0,
  consumedAt: null,
  createdAt: new Date(Date.now() - 10_000),
  ...over,
});

const customerRow = {
  id: 'c-1',
  email,
  name: null,
  phone: null,
  sessionVersion: 1,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OtpService', () => {
  const prisma = mockDeep<PrismaService>();
  const mailer = mock<EmailSender>();
  const sentMail = (i = 0) => mailer.send.mock.calls[i][0] as EmailMessage;
  const configWith = (over: Record<string, unknown> = {}) =>
    ({
      get: (key: string) => ({ OTP_PER_EMAIL_PER_15_MIN: 3, EMAIL_PROVIDER: 'console', NODE_ENV: 'test', OTP_DEV_CODE_IN_RESPONSE: false, ALLOW_TEST_CHECKOUT: false, ...over })[key],
    }) as unknown as ConfigService<Env, true>;
  const service = new OtpService(prisma, mailer, configWith());

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(randomInt).mockImplementation(((min: number, max: number) => realCrypto.randomInt(min, max)) as unknown as typeof randomInt);
    prisma.$transaction.mockImplementation((arg: unknown) =>
      (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])) as never,
    );
    mailer.send.mockResolvedValue(undefined);
    prisma.customerOtp.count.mockResolvedValue(0);
    prisma.customerOtp.create.mockImplementation(((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'otp-1', ...args.data })) as never);
  });

  describe('issue', () => {
    it('stores only the hash of the code, emails the code, and answers the expiry', async () => {
      const before = Date.now();
      const result = await service.issue(email, 'en');

      expect(mailer.send).toHaveBeenCalledTimes(1);
      const mail = sentMail();
      expect(mail.to).toEqual([email]);
      const sent = /\d{6}/.exec(mail.text)?.[0];
      expect(sent).toBeDefined();
      expect(mail.subject).toContain('Wolf Car');
      expect(mail.html).toContain(sent as string);

      const args = prisma.customerOtp.create.mock.calls[0][0];
      const data = args.data as { email: string; codeHash: string; expiresAt: Date };
      expect(data.email).toBe(email);
      expect(data.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data.codeHash).toBe(sha256Hex(`${sent}:${email}`));
      expect(JSON.stringify(args)).not.toContain(sent as string);
      expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(300_000 - 2_000);
      expect(data.expiresAt.getTime() - before).toBeLessThanOrEqual(300_000 + 2_000);

      expect(result.expiresAt.getTime()).toBe(data.expiresAt.getTime());
      expect(result.devCode).toBe(sent);
    });

    it('zero-pads a small code to six digits', async () => {
      jest.mocked(randomInt).mockImplementation((() => 123) as unknown as typeof randomInt);
      const result = await service.issue(email, 'ar');
      expect(result.devCode).toBe('000123');
      expect(sentMail().text).toContain('000123');
      const data = prisma.customerOtp.create.mock.calls[0][0].data as { codeHash: string };
      expect(data.codeHash).toBe(sha256Hex(`000123:${email}`));
    });

    it('writes the email in the language asked for', async () => {
      await service.issue(email, 'ar');
      expect(sentMail().html).toContain('dir="rtl"');
      await service.issue(email, 'en');
      expect(sentMail(1).html).toContain('dir="ltr"');
    });

    it('keeps the code out of the answer with Brevo in production', async () => {
      const result = await new OtpService(prisma, mailer, configWith({ NODE_ENV: 'production', EMAIL_PROVIDER: 'brevo' })).issue(email, 'en');
      expect(result.devCode).toBeUndefined();
      expect(mailer.send).toHaveBeenCalledTimes(1);
    });

    it('is 503 SIGN_IN_UNAVAILABLE with the console sender in production, and stores and sends nothing', async () => {
      const err = await new OtpService(prisma, mailer, configWith({ NODE_ENV: 'production' })).issue(email, 'en').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(503);
      expect(((err as HttpException).getResponse() as { code: string }).code).toBe('SIGN_IN_UNAVAILABLE');
      expect(prisma.customerOtp.create).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
    });

    it('answers the code in production only for the browser tests (ALLOW_TEST_CHECKOUT, OTP_DEV_CODE_IN_RESPONSE)', async () => {
      const config = configWith({ NODE_ENV: 'production', ALLOW_TEST_CHECKOUT: true, OTP_DEV_CODE_IN_RESPONSE: true });
      const result = await new OtpService(prisma, mailer, config).issue(email, 'en');
      const sent = /\d{6}/.exec(sentMail().text)?.[0];
      expect(result.devCode).toBe(sent);
    });

    it('is 503 SIGN_IN_UNAVAILABLE when Brevo refuses the email, and gives the code back so it does not count against the limit', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mailer.send.mockRejectedValue(new EmailSendError('Brevo refused the email', 'daily_limit_reached', 402));
      const err = await service.issue(email, 'en').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(503);
      expect(((err as HttpException).getResponse() as { code: string }).code).toBe('SIGN_IN_UNAVAILABLE');
      expect(prisma.customerOtp.delete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('daily_limit_reached'));
    });

    it('lets any other failure of the sender through as it is', async () => {
      mailer.send.mockRejectedValue(new Error('a bug'));
      await expect(service.issue(email, 'en')).rejects.toThrow('a bug');
    });

    it('counts the codes of the last 15 minutes for the email', async () => {
      await service.issue(email, 'en');
      const where = prisma.customerOtp.count.mock.calls[0][0]?.where as { email: string; createdAt: { gte: Date } };
      expect(where.email).toBe(email);
      expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(15 * 60_000 - 2_000);
      expect(Date.now() - where.createdAt.gte.getTime()).toBeLessThanOrEqual(15 * 60_000 + 2_000);
    });

    it('refuses a fourth code within 15 minutes with 429 OTP_TOO_MANY', async () => {
      prisma.customerOtp.count.mockResolvedValue(3);
      prisma.customerOtp.findFirst.mockResolvedValue(otpRow({ createdAt: new Date(Date.now() - 60_000) }) as never);
      prisma.customerOtp.findMany.mockResolvedValue([otpRow({ createdAt: new Date(Date.now() - 60_000) })] as never);

      const err = await service.issue(email, 'en').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      const body = (err as HttpException).getResponse() as { code: string; retryAfterSeconds: number };
      expect(body.code).toBe('OTP_TOO_MANY');
      expect(body.retryAfterSeconds).toEqual(expect.any(Number));
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
      expect(body.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
      expect(mailer.send).not.toHaveBeenCalled();
      expect(prisma.customerOtp.create).not.toHaveBeenCalled();
    });

    it('reads the per-email limit from OTP_PER_EMAIL_PER_15_MIN', async () => {
      const five = new OtpService(prisma, mailer, configWith({ OTP_PER_EMAIL_PER_15_MIN: 5 }));
      prisma.customerOtp.findFirst.mockResolvedValue(otpRow({ createdAt: new Date(Date.now() - 60_000) }) as never);
      prisma.customerOtp.findMany.mockResolvedValue([otpRow({ createdAt: new Date(Date.now() - 60_000) })] as never);

      prisma.customerOtp.count.mockResolvedValue(4);
      await expect(five.issue(email, 'en')).resolves.toMatchObject({ expiresAt: expect.any(Date) as Date });
      expect(mailer.send).toHaveBeenCalledTimes(1);

      prisma.customerOtp.count.mockResolvedValue(5);
      const err = await five.issue(email, 'en').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(mailer.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('verify', () => {
    const invalid = async (promise: Promise<unknown>) => {
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(401);
      expect(((err as HttpException).getResponse() as { code: string }).code).toBe('OTP_INVALID');
    };

    it('is 401 OTP_INVALID when there is no live code for the email', async () => {
      prisma.customerOtp.findFirst.mockResolvedValue(null);
      await invalid(service.verify(email, code));
      expect(prisma.customerOtp.updateMany).not.toHaveBeenCalled();
      expect(prisma.customer.upsert).not.toHaveBeenCalled();
    });

    it('looks only at the newest unconsumed, unexpired code of the email', async () => {
      prisma.customerOtp.findFirst.mockResolvedValue(null);
      await invalid(service.verify(email, code));
      const args = prisma.customerOtp.findFirst.mock.calls[0][0];
      expect(args?.where).toMatchObject({ email, consumedAt: null, expiresAt: { gt: expect.any(Date) as Date } });
      expect(JSON.stringify(args?.orderBy)).toContain('"createdAt":"desc"');
    });

    it('claims one attempt with a conditional update and gives up when none is left', async () => {
      prisma.customerOtp.findFirst.mockResolvedValue(otpRow({ attempts: OTP_MAX_ATTEMPTS }) as never);
      prisma.customerOtp.updateMany.mockResolvedValue({ count: 0 });
      await invalid(service.verify(email, code));
      expect(prisma.customerOtp.updateMany).toHaveBeenCalledWith({
        where: { id: 'otp-1', attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
      expect(prisma.customer.findUnique).not.toHaveBeenCalled();
      expect(prisma.customer.upsert).not.toHaveBeenCalled();
      expect(prisma.customerOtp.update).not.toHaveBeenCalled();
    });

    it('is 401 OTP_INVALID for a wrong code, after spending an attempt', async () => {
      prisma.customerOtp.findFirst.mockResolvedValue(otpRow() as never);
      prisma.customerOtp.updateMany.mockResolvedValue({ count: 1 });
      await invalid(service.verify(email, '000000'));
      expect(prisma.customerOtp.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.customer.upsert).not.toHaveBeenCalled();
      expect(prisma.customerOtp.update).not.toHaveBeenCalled();
    });

    it('consumes the row and finds or creates the customer for the right code', async () => {
      prisma.customerOtp.findFirst.mockResolvedValue(otpRow() as never);
      prisma.customerOtp.updateMany.mockResolvedValue({ count: 1 });
      prisma.customer.upsert.mockResolvedValue(customerRow as never);

      const result = await service.verify(email, code);

      const consume = prisma.customerOtp.update.mock.calls[0][0];
      expect(consume.where).toEqual({ id: 'otp-1' });
      expect((consume.data as { consumedAt: Date }).consumedAt).toBeInstanceOf(Date);

      const upsert = prisma.customer.upsert.mock.calls[0][0];
      expect(upsert.where).toEqual({ email });
      expect(upsert.create).toMatchObject({ email });
      expect((upsert.update as { lastLoginAt: Date }).lastLoginAt).toBeInstanceOf(Date);

      expect(result.customer).toMatchObject({ id: 'c-1', email, sessionVersion: 1 });
      expect(typeof result.created).toBe('boolean');
    });
  });
});
