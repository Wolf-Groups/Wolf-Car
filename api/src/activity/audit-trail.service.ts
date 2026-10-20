import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Role } from '../generated/prisma/client';

export interface AuditActor {
  id: string | null;
  username: string | null;
  role: Role | null;
  branchId: string | null;
}

export interface AuditState {
  actor?: AuditActor;
  action?: string;
  entityType?: string;
  entityId?: string;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  /** Set by markFailure: the request answered normally but the entry is a FAILURE. */
  outcome?: 'FAILURE';
}

const KEY = 'audit';

/**
 * Request-scoped scratchpad services use to enrich the activity-log entry that
 * AuditInterceptor writes when the request finishes: who acted (for routes that
 * have no authenticated user yet, like login), which entity, and before/after.
 */
@Injectable()
export class AuditTrail {
  constructor(private readonly cls: ClsService) {}

  private state(): AuditState {
    if (!this.cls.isActive()) return {};
    let s = this.cls.get<AuditState>(KEY);
    if (!s) {
      s = {};
      this.cls.set(KEY, s);
    }
    return s;
  }

  snapshot(): AuditState {
    return this.cls.isActive() ? { ...this.cls.get<AuditState | undefined>(KEY) } : {};
  }

  setActor(actor: AuditActor): this {
    this.state().actor = actor;
    return this;
  }

  setAction(action: string): this {
    this.state().action = action;
    return this;
  }

  setEntity(entityType: string, entityId: string): this {
    const s = this.state();
    s.entityType = entityType;
    s.entityId = entityId;
    return this;
  }

  setBranch(branchId: string | null): this {
    this.state().branchId = branchId;
    return this;
  }

  setChange(before: unknown, after: unknown): this {
    const s = this.state();
    s.before = before;
    s.after = after;
    return this;
  }

  addMetadata(data: Record<string, unknown>): this {
    const s = this.state();
    s.metadata = { ...s.metadata, ...data };
    return this;
  }

  /**
   * Records the entry as a FAILURE (metadata.reason = reason) although the
   * handler returns normally, e.g. a webhook we must answer 200.
   */
  markFailure(reason: string): this {
    const s = this.state();
    s.outcome = 'FAILURE';
    s.metadata = { ...s.metadata, reason };
    return this;
  }
}
