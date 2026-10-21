import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { CustomerPrincipal } from './customers.service';
import type { CustomerRequest } from './customer.guard';

/** The signed-in customer (set by CustomerGuard); 401 when a route forgot the guard. */
export const CurrentCustomer = createParamDecorator((_: unknown, ctx: ExecutionContext): CustomerPrincipal => {
  const req = ctx.switchToHttp().getRequest<CustomerRequest>();
  if (!req.customer) throw new UnauthorizedException();
  return req.customer;
});
