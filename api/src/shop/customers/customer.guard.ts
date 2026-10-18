import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuditTrail } from '../../activity/audit-trail.service';
import { todo } from '../todo';
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

  canActivate(ctx: ExecutionContext): Promise<boolean> {
    return todo('CustomerGuard.canActivate', this.customers, this.trail, ctx);
  }
}
