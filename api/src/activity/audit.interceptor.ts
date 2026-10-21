import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, concatMap, from, Observable, throwError } from 'rxjs';
import { AUDIT_KEY, AuditOptions, SKIP_AUDIT_KEY } from '../common/decorators/audit.decorator';
import { describeError } from '../common/filters/all-exceptions.filter';
import { AppRequest, requestMeta } from '../common/types';
import { ActivityService } from './activity.service';
import { AuditTrail } from './audit-trail.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Writes one activity-log entry per audited request, after the handler
 * finishes (success) or throws (failure). The response waits for the write,
 * so the log is never behind what the client has already seen.
 *
 * Mutating routes without @Audit/@SkipAudit are still logged generically as
 * `http.<method>` — the route-coverage test turns that fallback into a failure.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly activity: ActivityService,
    private readonly trail: AuditTrail,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const handler = ctx.getHandler();
    const meta = this.reflector.get<AuditOptions | undefined>(AUDIT_KEY, handler);
    const skip = this.reflector.get<string | undefined>(SKIP_AUDIT_KEY, handler);
    const req = ctx.switchToHttp().getRequest<AppRequest>();

    if (!meta && (skip || !MUTATING.has(req.method))) return next.handle();
    const options: AuditOptions = meta ?? { action: `http.${req.method.toLowerCase()}`, entity: undefined };

    return next.handle().pipe(
      concatMap((body: unknown) => from(this.write(req, options, { body }).then(() => body))),
      catchError((err: unknown) => from(this.write(req, options, { err })).pipe(concatMap(() => throwError(() => err)))),
    );
  }

  /** `err` present: the handler threw. Otherwise it answered `body`, and the entry is a SUCCESS unless the handler called trail.markFailure. */
  private async write(req: AppRequest, options: AuditOptions, result: { body: unknown } | { err: unknown }): Promise<void> {
    const state = this.trail.snapshot();
    const thrown = 'err' in result;
    const body = thrown ? undefined : result.body;
    const outcome = thrown ? 'FAILURE' : (state.outcome ?? 'SUCCESS');
    const actor = state.actor ?? (req.user
      ? { id: req.user.id, username: req.user.username, role: req.user.role, branchId: req.user.branchId }
      : undefined);
    const rawParam = options.idParam ? req.params?.[options.idParam] : undefined;
    const paramId = typeof rawParam === 'string' ? rawParam : undefined;
    const bodyId =
      body && typeof body === 'object' && 'id' in body && typeof (body as { id: unknown }).id === 'string'
        ? (body as { id: string }).id
        : undefined;

    const metadata: Record<string, unknown> = { ...state.metadata };
    if (!options.entity && !state.entityType && options.action.startsWith('http.')) {
      metadata.path = req.route?.path ?? req.path;
    }
    if (thrown) {
      // the same mapping as the exception filter: log what the client received
      const error = describeError(result.err);
      metadata.status = error.statusCode;
      if (error.code) metadata.reason = error.code;
      else if (error.statusCode < 500) metadata.reason = error.message.slice(0, 200);
    }

    const { ip, userAgent } = requestMeta(req);
    await this.activity.record({
      action: state.action ?? options.action,
      outcome,
      actorId: actor?.id ?? null,
      actorUsername: actor?.username ?? null,
      actorRole: actor?.role ?? null,
      branchId: state.branchId !== undefined ? state.branchId : (actor?.branchId ?? null),
      entityType: state.entityType ?? options.entity ?? null,
      entityId: state.entityId ?? paramId ?? bodyId ?? null,
      before: state.before,
      after: state.after,
      metadata: Object.keys(metadata).length ? metadata : undefined,
      ip,
      userAgent,
      requestId: req.id,
    });
  }
}
