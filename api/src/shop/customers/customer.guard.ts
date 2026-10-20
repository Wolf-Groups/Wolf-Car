import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuditTrail } from '../../activity/audit-trail.service';
import { hasCsrfHeader, readCustomerCookie } from '../../auth/cookies';
import { csrfRefused } from './csrf.guard';
import { CustomersService, type CustomerPrincipal } from './customers.service';

export interface CustomerRequest extends Request {
  customer?: CustomerPrincipal;
}

/**
 * For the @Public() /api/shop routes: the request must carry a valid customer
 * cookie (wc_cst). Non-GET requests also need the CSRF header, as every
 * cookie-authenticated route does. Sets the audit actor to the customer
 * (username = phone, no id, no role) so the activity log names who acted.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(
    private readonly customers: CustomersService,
    private readonly trail: AuditTrail,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<CustomerRequest>();
    const customer = await this.customers.loadFromToken(readCustomerCookie(req));
    req.customer = customer;
    this.trail.setActor({ id: null, username: customer.phone, role: null, branchId: null });
    if (req.method !== 'GET' && !hasCsrfHeader(req)) throw csrfRefused();
    return true;
  }
}
