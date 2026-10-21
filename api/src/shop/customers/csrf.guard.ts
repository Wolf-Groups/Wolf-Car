import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { hasCsrfHeader } from '../../auth/cookies';

export const csrfRefused = () =>
  new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'CSRF', message: 'Missing request header.' });

/**
 * For the /api/shop sign-in routes that run before there is a cookie: a
 * cross-site HTML form needs no preflight and the API also parses urlencoded
 * bodies, so without the header any page could sign its visitors into the
 * attacker's account or make their browsers request codes. A guard, so it
 * runs before validation.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.method !== 'GET' && !hasCsrfHeader(req)) throw csrfRefused();
    return true;
  }
}
