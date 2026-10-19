import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mock } from 'jest-mock-extended';
import { ClsServiceManager } from 'nestjs-cls';
import { lastValueFrom, of, throwError } from 'rxjs';
import { authUser, httpContext } from '../../test/unit/helpers';
import { AUDIT_KEY, SKIP_AUDIT_KEY } from '../common/decorators/audit.decorator';
import type { ActivityService } from './activity.service';
import { AuditTrail } from './audit-trail.service';
import { AuditInterceptor } from './audit.interceptor';

const handler = (key?: string, value?: unknown) => {
  const fn = () => undefined;
  if (key) Reflect.defineMetadata(key, value, fn);
  return fn;
};

describe('AuditInterceptor', () => {
  const activity = mock<ActivityService>();
  const trail = mock<AuditTrail>();
  const interceptor = new AuditInterceptor(new Reflector(), activity, trail);
  beforeEach(() => {
    jest.resetAllMocks();
    trail.snapshot.mockReturnValue({});
  });

  it('records a success with the entity id from the route param', async () => {
    const ctx = httpContext(
      { method: 'PATCH', params: { id: 'p-9' }, user: authUser({ role: 'FINANCE', branchId: null }) },
      handler(AUDIT_KEY, { action: 'product.price.update', entity: 'Product', idParam: 'id' }),
    );
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ ok: true }) }));
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.price.update',
        outcome: 'SUCCESS',
        entityType: 'Product',
        entityId: 'p-9',
        actorRole: 'FINANCE',
        requestId: 'req-1',
      }),
    );
  });

  it('uses before/after and actor from the audit trail', async () => {
    trail.snapshot.mockReturnValue({
      actor: { id: 'x', username: 'gh.manager', role: 'BRANCH_MANAGER', branchId: 'b-2' },
      entityType: 'Order',
      entityId: 'o-1',
      before: { status: 'PENDING' },
      after: { status: 'CONFIRMED' },
    });
    const ctx = httpContext({ method: 'POST' }, handler(AUDIT_KEY, { action: 'order.confirm' }));
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(undefined) }));
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUsername: 'gh.manager',
        branchId: 'b-2',
        entityId: 'o-1',
        before: { status: 'PENDING' },
        after: { status: 'CONFIRMED' },
      }),
    );
  });

  it('records failures with status and reason, then rethrows', async () => {
    const ctx = httpContext({ method: 'POST', user: authUser() }, handler(AUDIT_KEY, { action: 'order.confirm' }));
    const err = new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'no' });
    await expect(lastValueFrom(interceptor.intercept(ctx, { handle: () => throwError(() => err) }))).rejects.toBe(err);
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILURE', metadata: expect.objectContaining({ status: 403, reason: 'MISSING_PERMISSION' }) }),
    );
  });

  it('records a FAILURE with the reason when the handler marked it so but answered normally, and passes the answer through', async () => {
    const ctx = httpContext({ method: 'POST', params: {} }, handler(AUDIT_KEY, { action: 'shop.payment.webhook', entity: 'Payment' }));
    const answer = { received: true };
    const result = await lastValueFrom(
      interceptor.intercept(ctx, {
        handle: () => {
          // what trail.markFailure('X') leaves in the request state
          trail.snapshot.mockReturnValue({ outcome: 'FAILURE', metadata: { reason: 'X' } });
          return of(answer);
        },
      }),
    );
    expect(result).toBe(answer);
    expect(activity.record).toHaveBeenCalledTimes(1);
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shop.payment.webhook', outcome: 'FAILURE', metadata: expect.objectContaining({ reason: 'X' }) }),
    );
  });

  it('a handler that calls the real markFailure and returns normally yields one FAILURE entry', async () => {
    const cls = ClsServiceManager.getClsService();
    const realTrail = new AuditTrail(cls);
    const real = new AuditInterceptor(new Reflector(), activity, realTrail);
    await cls.run(async () => {
      const ctx = httpContext({ method: 'POST' }, handler(AUDIT_KEY, { action: 'shop.payment.webhook', entity: 'Payment' }));
      await lastValueFrom(
        real.intercept(ctx, {
          handle: () => {
            realTrail.addMetadata({ chargeId: 'chg_1' }).markFailure('X');
            return of({ received: true });
          },
        }),
      );
    });
    expect(activity.record).toHaveBeenCalledTimes(1);
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILURE', metadata: expect.objectContaining({ reason: 'X', chargeId: 'chg_1' }) }),
    );
  });

  it('skips reads and explicitly skipped routes', async () => {
    await lastValueFrom(interceptor.intercept(httpContext({ method: 'GET' }, handler()), { handle: () => of(1) }));
    await lastValueFrom(
      interceptor.intercept(httpContext({ method: 'POST' }, handler(SKIP_AUDIT_KEY, 'reason')), { handle: () => of(1) }),
    );
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('falls back to a generic entry for un-annotated mutating routes', async () => {
    await lastValueFrom(interceptor.intercept(httpContext({ method: 'DELETE', path: '/api/x' }, handler()), { handle: () => of(1) }));
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'http.delete' }));
  });
});
