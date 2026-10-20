import { ArgumentsHost, BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '../../generated/prisma/client';
import { AccountLockedException } from '../errors';
import { AllExceptionsFilter, describeError } from './all-exceptions.filter';

function run(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn(), headersSent: false };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'rid', originalUrl: '/x' }) }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter();
  jest.spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
  filter.catch(exception, host);
  return { status: res.status.mock.calls[0][0] as number, body: res.json.mock.calls[0][0], res };
}

describe('AllExceptionsFilter', () => {
  it('passes HttpExceptions through with the request id', () => {
    const { status, body } = run(new NotFoundException('Order not found.'));
    expect(status).toBe(404);
    expect(body).toMatchObject({ statusCode: 404, message: 'Order not found.', requestId: 'rid' });
  });

  it('keeps structured validation errors', () => {
    const { body } = run(new BadRequestException({ message: 'Some fields are not valid.', errors: [{ field: 'price' }] }));
    expect(body.errors).toEqual([{ field: 'price' }]);
  });

  it('never leaks internals of unknown errors', () => {
    const { status, body } = run(new Error('connect ECONNREFUSED 10.0.0.1:5432 password=hunter2'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|hunter2|stack/);
  });

  it('maps unique violations to 409 with a friendly message', () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
      meta: { target: ['barcode'] },
    });
    const { status, body } = run(err);
    expect(status).toBe(409);
    expect(body.message).toBe('Another product already uses this barcode.');
  });

  it('maps the branch staffing constraint to 409', () => {
    const { status, body } = run({ message: 'branch x must have exactly one manager', cause: { message: 'branch_staffing' } });
    expect(status).toBe(409);
    expect(body.message).toContain('exactly one branch manager');
  });

  it('adds Retry-After for lockouts and handles throttling', () => {
    const locked = run(new AccountLockedException(900));
    expect(locked.status).toBe(423);
    expect(locked.res.setHeader).toHaveBeenCalledWith('Retry-After', '900');
    expect(run(new ThrottlerException()).status).toBe(429);
  });

  it('maps multer size errors to 413', () => {
    expect(run({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' }).status).toBe(413);
  });

  it('passes the unavailable productIds through, and drops anything that is not a list of ids', () => {
    const unavailable = (productIds: unknown) => new BadRequestException({ code: 'PRODUCT_UNAVAILABLE', message: 'Some products are no longer available.', productIds });
    expect(run(unavailable(['p1', 'p2'])).body).toMatchObject({ statusCode: 400, code: 'PRODUCT_UNAVAILABLE', productIds: ['p1', 'p2'] });
    expect(describeError(unavailable('p1'))).not.toHaveProperty('productIds');
    expect(describeError(unavailable([{ id: 'p1' }]))).not.toHaveProperty('productIds');
  });

  it('passes a string reason through (402 PAYMENT_FAILED, 502 REFUND_FAILED), and drops any other kind', () => {
    // read loosely: ErrorBody gains `reason?: string` in the plan's Task 6
    const reasonOf = (e: unknown) => (describeError(e) as unknown as Record<string, unknown>).reason;
    expect(reasonOf(new HttpException({ code: 'PAYMENT_FAILED', message: 'The card was not accepted.', reason: 'INVALID_TOKEN' }, 402))).toBe('INVALID_TOKEN');
    expect(run(new HttpException({ code: 'REFUND_FAILED', message: 'The refund did not go through.', reason: 'REFUND_DECLINED' }, 502)).body).toMatchObject({
      statusCode: 502,
      code: 'REFUND_FAILED',
      reason: 'REFUND_DECLINED',
    });
    const odd = describeError(new HttpException({ code: 'PAYMENT_FAILED', message: 'x', reason: { secret: 'sk_live_x' } }, 402));
    expect(odd).not.toHaveProperty('reason');
    expect(odd).toMatchObject({ statusCode: 402, code: 'PAYMENT_FAILED' });
    expect(describeError(new HttpException({ code: 'PAYMENT_FAILED', message: 'x', reason: 42 }, 402))).not.toHaveProperty('reason');
  });
});
