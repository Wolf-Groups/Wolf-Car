import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { AuditTrail } from '../../activity/audit-trail.service';
import { hasCsrfHeader, readCustomerCookie } from '../../auth/cookies';
import { AuthFailedException } from '../../common/errors';
import type { OrderAccess } from '../checkout/order-access';
import { csrfRefused } from './csrf.guard';
import type { CustomerRequest } from './customer.guard';
import { CustomersService } from './customers.service';

/**
 * For the /api/shop order routes a guest may use too (placing an order,
 * opening it with its key, paying it): attaches the customer when the cookie
 * is valid, and lets anyone else through as a guest — a stale cookie is no
 * reason to refuse a checkout. Non-GET requests always need the CSRF header.
 */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(
    private readonly customers: CustomersService,
    private readonly trail: AuditTrail,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<CustomerRequest>();
    if (req.method !== 'GET' && !hasCsrfHeader(req)) throw csrfRefused();
    const token = readCustomerCookie(req);
    if (!token) return true;
    try {
      req.customer = await this.customers.loadFromToken(token);
    } catch (err) {
      if (err instanceof AuthFailedException) return true;
      throw err;
    }
    this.trail.setActor({ id: null, username: req.customer.email, role: null, branchId: null });
    return true;
  }
}

/** The customer (if signed in) and the X-Order-Key header (if sent), for routes behind OptionalCustomerGuard or CustomerGuard. */
export const CurrentOrderAccess = createParamDecorator((_: unknown, ctx: ExecutionContext): OrderAccess => {
  const req = ctx.switchToHttp().getRequest<CustomerRequest>();
  const key = req.headers['x-order-key'];
  return { customer: req.customer ?? null, key: typeof key === 'string' ? key : null };
});
