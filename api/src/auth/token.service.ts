import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env';
import { ActivityService } from '../activity/activity.service';
import { AuthFailedException } from '../common/errors';
import { randomToken, sha256Hex } from '../common/crypto';
import type { RequestMeta } from '../common/types';
import type { Prisma, Role, SessionAudience } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const JWT_ISSUER = 'wolfcar-api';
export type AccessAudience = 'dashboard' | 'showroom';
const CHALLENGE_AUDIENCE = '2fa-challenge';
const SLOTS_AUDIENCE = 'slots';
/** Website customers (online checkout); see signCustomer. */
export const CUSTOMER_AUDIENCE = 'customer';
/** How long a phone stays unlocked on the sales slots page. */
export const SLOTS_TTL_DAYS = 90;

/** A used refresh token presented again within this window is treated as a benign race (two tabs), not theft. */
const REUSE_GRACE_MS = 10_000;

export interface AccessPayload {
  sub: string;
  sid: string;
  aud: AccessAudience;
  role: Role;
  bid: string | null;
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export const toAccessAudience = (a: SessionAudience): AccessAudience => (a === 'SHOWROOM' ? 'showroom' : 'dashboard');

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly activity: ActivityService,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  async signAccess(
    user: { id: string; role: Role; branchId: string | null },
    sessionId: string,
    audience: SessionAudience,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const payload: Omit<AccessPayload, 'aud'> = { sub: user.id, sid: sessionId, role: user.role, bid: user.branchId };
    const accessToken = await this.jwt.signAsync(payload, {
      audience: toAccessAudience(audience),
      expiresIn: this.accessTtlSeconds,
    });
    return { accessToken, expiresIn: this.accessTtlSeconds };
  }

  async verifyAccess(token: string): Promise<AccessPayload> {
    return this.jwt.verifyAsync<AccessPayload>(token, { audience: ['dashboard', 'showroom'] });
  }

  /**
   * The website customer's cookie token: sub = customer id, ver = the
   * customer's sessionVersion (a bump signs every device out), valid
   * CUSTOMER_SESSION_TTL_DAYS. Implemented in Task 4 of the online-checkout plan.
   */
  signCustomer(customerId: string, version: number): Promise<{ token: string; expiresAt: Date }> {
    throw new Error(`TODO(phase1): TokenService.signCustomer ${customerId} ${version}`);
  }

  /** Throws AuthFailedException('SESSION_EXPIRED') for anything but a valid customer token. */
  verifyCustomer(token: string): Promise<{ sub: string; ver: number }> {
    throw new Error(`TODO(phase1): TokenService.verifyCustomer ${token.length}`);
  }

  /** Short-lived token proving the password step succeeded; exchanged for a session after TOTP. */
  signChallenge(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, jti: randomToken(12) }, { audience: CHALLENGE_AUDIENCE, expiresIn: 300 });
  }

  async verifyChallenge(token: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, { audience: CHALLENGE_AUDIENCE });
      return payload.sub;
    } catch {
      throw new AuthFailedException('SESSION_EXPIRED');
    }
  }

  /**
   * Token for the sales slots page (no user). It carries the PIN version, so
   * changing the PIN invalidates every token already issued. Its audience is
   * rejected by verifyAccess, so it never opens a dashboard or showroom route.
   */
  async signSlots(version: number): Promise<{ token: string; expiresAt: Date }> {
    const token = await this.jwt.signAsync({ v: version }, { audience: SLOTS_AUDIENCE, expiresIn: SLOTS_TTL_DAYS * 86_400 });
    return { token, expiresAt: new Date(Date.now() + SLOTS_TTL_DAYS * 86_400_000) };
  }

  /** The PIN version the token was issued for, or null when the token is not a valid slots token. */
  async verifySlots(token: string): Promise<number | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ v?: unknown }>(token, { audience: SLOTS_AUDIENCE });
      return typeof payload.v === 'number' ? payload.v : null;
    } catch {
      return null;
    }
  }

  private sessionExpiry(audience: SessionAudience): Date {
    const now = Date.now();
    return audience === 'SHOWROOM'
      ? new Date(now + this.config.get('SHOWROOM_SESSION_TTL_HOURS', { infer: true }) * 3_600_000)
      : new Date(now + this.config.get('REFRESH_TTL_DAYS', { infer: true }) * 86_400_000);
  }

  async createSession(
    userId: string,
    audience: SessionAudience,
    meta: RequestMeta,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<IssuedSession> {
    const expiresAt = this.sessionExpiry(audience);
    const refreshToken = randomToken(32);
    const session = await db.session.create({
      data: {
        userId,
        audience,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
        refreshTokens: { create: { tokenHash: sha256Hex(refreshToken), expiresAt } },
      },
    });
    return { sessionId: session.id, refreshToken, expiresAt };
  }

  /**
   * Rotates a refresh token: the presented token is marked used and a new one
   * is issued in the same session (absolute expiry unchanged). Presenting an
   * already-used token after the grace window revokes the whole session.
   */
  async rotate(rawToken: string, audience: SessionAudience, meta: RequestMeta): Promise<IssuedSession & { userId: string }> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(rawToken) },
      include: { session: { include: { user: { select: { id: true, username: true, role: true, branchId: true } } } } },
    });
    const now = new Date();
    if (!token || token.session.audience !== audience || token.session.revokedAt || token.session.expiresAt <= now) {
      throw new AuthFailedException('SESSION_EXPIRED');
    }

    if (token.usedAt) {
      if (now.getTime() - token.usedAt.getTime() > REUSE_GRACE_MS) {
        await this.revokeSession(token.sessionId, 'refresh_reuse');
        const u = token.session.user;
        await this.activity.record({
          action: 'auth.refresh.reuse_detected',
          outcome: 'FAILURE',
          actorId: u.id,
          actorUsername: u.username,
          actorRole: u.role,
          branchId: u.branchId,
          entityType: 'Session',
          entityId: token.sessionId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      throw new AuthFailedException('SESSION_EXPIRED');
    }

    const refreshToken = randomToken(32);
    const rotated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: now } });
      if (claimed.count === 0) return false; // lost a race with a concurrent refresh
      await tx.refreshToken.create({
        data: { sessionId: token.sessionId, tokenHash: sha256Hex(refreshToken), expiresAt: token.session.expiresAt },
      });
      await tx.session.update({
        where: { id: token.sessionId },
        data: { lastUsedAt: now, ip: meta.ip, userAgent: meta.userAgent },
      });
      return true;
    });
    if (!rotated) throw new AuthFailedException('SESSION_EXPIRED');

    return { sessionId: token.sessionId, refreshToken, expiresAt: token.session.expiresAt, userId: token.session.userId };
  }

  async sessionIdForRefreshToken(rawToken: string): Promise<string | null> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(rawToken) },
      select: { sessionId: true },
    });
    return token?.sessionId ?? null;
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  /** Revokes every active session of the user (password change/reset, deactivation, 2FA reset). */
  async revokeUserSessions(
    userId: string,
    reason: string,
    options: { audience?: SessionAudience } = {},
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const result = await db.session.updateMany({
      where: { userId, revokedAt: null, ...(options.audience ? { audience: options.audience } : {}) },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return result.count;
  }
}
