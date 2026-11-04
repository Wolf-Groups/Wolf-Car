import { ForbiddenException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { httpContext } from '../../../test/unit/helpers';
import type { AuditTrail } from '../../activity/audit-trail.service';
import { AuthFailedException } from '../../common/errors';
import type { AppRequest } from '../../common/types';
import type { CustomerRequest } from './customer.guard';
import type { CustomerPrincipal, CustomersService } from './customers.service';
import { OptionalCustomerGuard } from './optional-customer.guard';

const principal: CustomerPrincipal = { id: 'c-1', email: 'sara@example.qa', name: 'Sara', phone: null, sessionVersion: 1 };
const context = (method: string, headers: Record<string, string> = {}, cookies: Record<string, string> = {}) =>
  httpContext({ method, headers, cookies } as Partial<AppRequest>);

describe('OptionalCustomerGuard', () => {
  const customers = mock<CustomersService>();
  const trail = mock<AuditTrail>();
  const guard = new OptionalCustomerGuard(customers, trail);

  beforeEach(() => {
    jest.resetAllMocks();
    trail.setActor.mockReturnValue(trail);
  });

  it('attaches the signed-in customer and names them as the audit actor', async () => {
    customers.loadFromToken.mockResolvedValue(principal);
    const ctx = context('GET', {}, { wc_cst: 'token' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.switchToHttp().getRequest<CustomerRequest>().customer).toBe(principal);
    expect(trail.setActor).toHaveBeenCalledWith({ id: null, username: 'sara@example.qa', role: null, branchId: null });
  });

  it('lets a visitor without a cookie through as a guest', async () => {
    const ctx = context('GET');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.switchToHttp().getRequest<CustomerRequest>().customer).toBeUndefined();
    expect(customers.loadFromToken).not.toHaveBeenCalled();
  });

  it('treats a stale or invalid cookie as a guest, not as an error', async () => {
    customers.loadFromToken.mockRejectedValue(new AuthFailedException('SESSION_EXPIRED'));
    const ctx = context('POST', { 'x-requested-with': 'wolfcar' }, { wc_cst: 'old' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.switchToHttp().getRequest<CustomerRequest>().customer).toBeUndefined();
  });

  it('refuses a POST without the CSRF header, guest or not', async () => {
    await expect(guard.canActivate(context('POST'))).rejects.toBeInstanceOf(ForbiddenException);
    customers.loadFromToken.mockResolvedValue(principal);
    await expect(guard.canActivate(context('POST', {}, { wc_cst: 'token' }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
