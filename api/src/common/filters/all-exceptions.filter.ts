import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '../../generated/prisma/client';
import type { AppRequest } from '../types';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  errors?: unknown;
  retryAfterSeconds?: number;
  /** PRODUCT_UNAVAILABLE: the basket lines the client should drop. */
  productIds?: string[];
  /** PAYMENT_FAILED (402) and REFUND_FAILED (502): the payment provider's error code. */
  reason?: string;
  requestId?: string;
}

const PG_CONSTRAINT_MESSAGES: Record<string, string> = {
  users_one_manager_per_branch: 'This branch already has a branch manager.',
  users_one_cashier_per_branch: 'This branch already has a cashier.',
  branch_staffing: 'Each branch must have exactly one branch manager and one cashier.',
  users_role_branch_check: 'Branch managers and cashiers must belong to a branch; other roles must not.',
};

/**
 * Single place that shapes every error response. It never includes stack
 * traces or driver messages; unexpected errors are logged with the request id
 * and returned as a generic 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();
    const body = describeError(exception);
    body.requestId = req.id;

    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId: req.id, path: req.originalUrl },
        'Unhandled error',
      );
    }
    if (body.retryAfterSeconds) res.setHeader('Retry-After', String(body.retryAfterSeconds));
    if (!res.headersSent) res.status(body.statusCode).json(body);
  }
}

/**
 * Maps any thrown value to the response the client receives. Also used by the
 * audit interceptor, so the activity log records the same status (e.g. 409 for
 * a duplicate barcode, not 500).
 */
export function describeError(exception: unknown): ErrorBody {
  if (exception instanceof ThrottlerException) {
    return { statusCode: 429, error: 'Too Many Requests', code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' };
  }
  if (exception instanceof HttpException && exception.getStatus() === 413) {
    // multer's size limit, surfaced by Nest's FileInterceptor
    return { statusCode: 413, error: 'Payload Too Large', code: 'FILE_TOO_LARGE', message: 'The image is larger than 5 MB.' };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return { statusCode: status, error: HttpStatus[status] ?? 'Error', message: response };
    }
    const r = response as Record<string, unknown>;
    const message = Array.isArray(r.message)
      ? r.message.join('; ')
      : typeof r.message === 'string'
        ? r.message
        : exception.message;
    return {
      statusCode: status,
      error: typeof r.error === 'string' ? r.error : (HttpStatus[status] ?? 'Error'),
      message,
      ...(typeof r.code === 'string' ? { code: r.code } : {}),
      ...(r.errors ? { errors: r.errors } : {}),
      ...(typeof r.retryAfterSeconds === 'number' ? { retryAfterSeconds: r.retryAfterSeconds } : {}),
      ...(isStringArray(r.productIds) ? { productIds: r.productIds } : {}),
      ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
    };
  }
  if (isMulterError(exception)) {
    if (exception.code === 'LIMIT_FILE_SIZE') {
      return { statusCode: 413, error: 'Payload Too Large', code: 'FILE_TOO_LARGE', message: 'The image is larger than 5 MB.' };
    }
    return { statusCode: 400, error: 'Bad Request', code: 'UPLOAD_REJECTED', message: 'The upload was rejected.' };
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      return { statusCode: 409, error: 'Conflict', code: 'DUPLICATE', message: duplicateMessage(exception) };
    }
    if (exception.code === 'P2025') {
      return { statusCode: 404, error: 'Not Found', message: 'Resource not found.' };
    }
  }
  const constraint = pgConstraint(exception);
  if (constraint) {
    return {
      statusCode: 409,
      error: 'Conflict',
      code: 'CONSTRAINT',
      message: PG_CONSTRAINT_MESSAGES[constraint] ?? 'The change violates a data rule.',
    };
  }
  return { statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong.' };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isMulterError(e: unknown): e is { name: 'MulterError'; code: string } {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'MulterError';
}

function duplicateMessage(e: Prisma.PrismaClientKnownRequestError): string {
  const text = JSON.stringify(e.meta ?? {});
  for (const [name, message] of Object.entries(PG_CONSTRAINT_MESSAGES)) {
    if (text.includes(name)) return message;
  }
  if (text.includes('barcode')) return 'Another product already uses this barcode.';
  if (text.includes('username')) return 'This username is taken.';
  if (text.includes('email')) return 'This email is already in use.';
  if (text.includes('code')) return 'This code is already in use.';
  return 'A record with the same unique value already exists.';
}

/** Finds a named Postgres constraint in driver-adapter errors (raised at COMMIT by deferred triggers). */
function pgConstraint(e: unknown): string | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [e];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    const message = (cur as { message?: unknown }).message;
    const text = `${typeof message === 'string' ? message : ''} ${JSON.stringify((cur as { meta?: unknown }).meta ?? '')}`;
    for (const name of Object.keys(PG_CONSTRAINT_MESSAGES)) {
      if (text.includes(name)) return name;
    }
    if (/violates check constraint|check_violation|23514|23505/.test(text)) return 'unknown';
    stack.push((cur as { cause?: unknown }).cause, (cur as { meta?: unknown }).meta);
  }
  return null;
}
