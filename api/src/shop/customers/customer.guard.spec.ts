import { ForbiddenException, HttpException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { httpContext } from '../../../test/unit/helpers';
import type { AuditTrail } from '../../activity/audit-trail.service';
import { AuthFailedException } from '../../common/errors';
import type { AppRequest } from '../../common/types';
import { CustomerGuard, type CustomerRequest } from './customer.guard';
import type { CustomerPrincipal, CustomersService } from './customers.service';

const principal: CustomerPrincipal = { id: 'c-1', phone: '+97455123456', name: 'Sara', email: 'sara@example.qa', sessionVersion: 2 };

const context = (method: string, headers: Record<string, string> = {}, cookies: Record<string, string> = { wc_cst: 'cookie-token' }) =>
  httpContext({ method, headers, cookies } as Partial<AppRequest>);

describe('CustomerGuard', () => {
  const customers = mock<CustomersService>();
  const trail = mock<AuditTrail>();
  const guard = new CustomerGuard(customers, trail);

  beforeEach(() => {
    jest.resetAllMocks();
    trail.setActor.mockReturnValue(trail);
    customers.loadFromToken.mockResolvedValue(principal);
  });

  it('loads the customer from the wc_cst cookie, attaches it and names it as the audit actor', async () => {
    const ctx = context('GET');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(customers.loadFromToken).toHaveBeenCalledWith('cookie-token');
    expect(ctx.switchToHttp().getRequest<CustomerRequest>().customer).toBe(principal);
    expect(trail.setActor).toHaveBeenCalledWith({ id: null, username: '+97455123456', role: null, branchId: null });
  });

  it('lets a GET through without the CSRF header', async () => {
    await expect(guard.canActivate(context('GET'))).resolves.toBe(true);
  });

  it('refuses a POST without the CSRF header (403 CSRF)', async () => {
    const err = await guard.canActivate(context('POST')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(((err as HttpException).getResponse() as { code: string }).code).toBe('CSRF');
  });

  it('refuses a POST whose CSRF header has another value', async () => {
    const err = await guard.canActivate(context('POST', { 'x-requested-with': 'XMLHttpRequest' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it('accepts a POST with X-Requested-With: wolfcar', async () => {
    await expect(guard.canActivate(context('POST', { 'x-requested-with': 'wolfcar' }))).resolves.toBe(true);
  });

  it('passes the session error on when the cookie is missing or stale', async () => {
    customers.loadFromToken.mockRejectedValue(new AuthFailedException('SESSION_EXPIRED'));
    await expect(guard.canActivate(context('GET', {}, {}))).rejects.toBeInstanceOf(AuthFailedException);
    expect(customers.loadFromToken).toHaveBeenCalledWith(undefined);
  });
});
