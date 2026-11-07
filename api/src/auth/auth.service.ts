import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { AuditTrail } from '../activity/audit-trail.service';
import { AccountLockedException, AuthFailedException } from '../common/errors';
import type { AuthUser, RequestMeta } from '../common/types';
import type { Role, SessionAudience } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto, ShowroomPinLoginDto, TwoFactorLoginDto } from './dto/login.dto';
import type { AuthResult, IssuedAuth, Profile, TwoFactorChallenge } from './auth.types';
import { LockoutService, type LoginChannel } from './lockout.service';
import { PasswordService } from './password.service';
import { SessionUserService } from './session-user.service';
import { ShowroomPinService } from './showroom-pin.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

const LOGIN_SELECT = {
  id: true,
  username: true,
  role: true,
  branchId: true,
  isActive: true,
  passwordHash: true,
  showroomPasswordHash: true,
  twoFactorEnabled: true,
  failedLoginCount: true,
  lockedUntil: true,
  showroomFailedCount: true,
  showroomLockedUntil: true,
  branch: { select: { isActive: true } },
} as const;

type LoginUser = {
  id: string;
  username: string;
  role: Role;
  branchId: string | null;
  isActive: boolean;
  passwordHash: string;
  showroomPasswordHash: string | null;
  twoFactorEnabled: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  showroomFailedCount: number;
  showroomLockedUntil: Date | null;
  branch: { isActive: boolean } | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly lockout: LockoutService,
    private readonly twoFactor: TwoFactorService,
    private readonly sessions: SessionUserService,
    private readonly pins: ShowroomPinService,
    private readonly trail: AuditTrail,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Step 1: username + password. Returns a session, or a 2FA challenge when TOTP is enabled. */
  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedAuth | TwoFactorChallenge> {
    const user = await this.checkPassword(dto, 'dashboard');
    if (user.twoFactorEnabled) {
      this.trail.addMetadata({ twoFactorRequired: true });
      return { twoFactorRequired: true, challengeToken: await this.tokens.signChallenge(user.id) };
    }
    return this.startSession(user, 'DASHBOARD', meta);
  }

  /** Step 2 (only when 2FA is on): TOTP code or a one-time recovery code. */
  async loginTwoFactor(dto: TwoFactorLoginDto, meta: RequestMeta): Promise<IssuedAuth> {
    const userId = await this.tokens.verifyChallenge(dto.challengeToken);
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: LOGIN_SELECT });
    if (!user || !user.isActive || !user.twoFactorEnabled) throw new AuthFailedException('SESSION_EXPIRED');
    this.trail.setActor(actorOf(user));

    const retry = this.lockout.retryAfter(user, user.username, 'dashboard');
    if (retry > 0) throw new AccountLockedException(retry);

    const usingRecovery = dto.recoveryCode !== undefined;
    this.trail.addMetadata({ method: usingRecovery ? 'recovery_code' : 'totp' });
    const ok = usingRecovery
      ? await this.twoFactor.useRecoveryCode(user.id, dto.recoveryCode as string)
      : await this.twoFactor.verifyCode(user.id, dto.code as string);
    if (!ok) {
      const locked = await this.lockout.registerFailure(user, user.username, 'dashboard');
      if (locked) throw this.lockedNow();
      throw new AuthFailedException('INVALID_2FA');
    }
    await this.lockout.registerSuccess(user, 'dashboard');
    return this.startSession(user, 'DASHBOARD', meta);
  }

  /** Showroom kiosk sign-in: username + the separate showroom password. */
  async showroomLogin(dto: LoginDto, meta: RequestMeta): Promise<IssuedAuth> {
    const user = await this.checkPassword(dto, 'showroom');
    const permissions = await this.sessions.permissionsFor(user);
    if (!user.branchId || !user.branch?.isActive || !permissions.has('order.create')) {
      this.trail.addMetadata({ reason: 'no_showroom_access' });
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'NO_SHOWROOM_ACCESS',
        message: 'This account cannot use the showroom.',
      });
    }
    return this.startSession(user, 'SHOWROOM', meta);
  }

  /**
   * Showroom screen sign-in: the branch and its PIN. The session belongs to
   * the branch's cashier, as it did when the cashier typed their own showroom
   * password, so orders and permissions work exactly as before.
   */
  async showroomPinLogin(dto: ShowroomPinLoginDto, meta: RequestMeta): Promise<IssuedAuth> {
    this.trail.addMetadata({ branchId: dto.branchId, channel: 'showroom_pin' });
    await this.pins.check(dto.branchId, dto.pin);
    // only now is the id known to be a real branch
    this.trail.setBranch(dto.branchId);
    const user = await this.prisma.user.findFirst({
      where: { branchId: dto.branchId, role: 'CASHIER', deletedAt: null, isActive: true },
      select: LOGIN_SELECT,
    });
    if (!user || !user.branch?.isActive || !(await this.sessions.permissionsFor(user)).has('order.create')) {
      this.trail.addMetadata({ reason: 'no_showroom_access' });
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'NO_SHOWROOM_ACCESS',
        message: 'This branch cannot use the showroom.',
      });
    }
    this.trail.setActor(actorOf(user));
    return this.startSession(user, 'SHOWROOM', meta);
  }

  async refresh(rawToken: string, audience: SessionAudience, meta: RequestMeta): Promise<IssuedAuth> {
    const rotated = await this.tokens.rotate(rawToken, audience, meta);
    return this.issue(rotated.userId, rotated, audience);
  }

  /** Revokes the session behind the refresh cookie (idempotent). */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const sessionId = await this.tokens.sessionIdForRefreshToken(rawToken);
    if (!sessionId) return;
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { user: { select: { id: true, username: true, role: true, branchId: true } } },
    });
    if (session) this.trail.setActor(actorOf(session.user)).setEntity('Session', sessionId);
    await this.tokens.revokeSession(sessionId, 'logout');
  }

  async profile(principal: Pick<AuthUser, 'id' | 'permissions'>): Promise<Profile> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        role: true,
        twoFactorEnabled: true,
        showroomPasswordHash: true,
        branch: { select: { id: true, code: true, name: true, nameAr: true } },
      },
    });
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      branch: u.branch,
      // so the dashboard opens that branch on its website orders, and every other branch on its showroom's
      branchHoldsWebOrders: u.branch?.code === this.config.get('WEB_ORDERS_BRANCH_CODE', { infer: true }),
      twoFactorEnabled: u.twoFactorEnabled,
      hasShowroomPassword: u.showroomPasswordHash !== null,
      permissions: [...principal.permissions].sort(),
    };
  }

  private async checkPassword(dto: LoginDto, channel: LoginChannel): Promise<LoginUser> {
    const username = dto.username;
    this.trail.addMetadata({ username, channel });
    const user = await this.prisma.user.findFirst({ where: { username, deletedAt: null }, select: LOGIN_SELECT });
    if (user) this.trail.setActor(actorOf(user));

    const retry = this.lockout.retryAfter(user, username, channel);
    if (retry > 0) {
      await this.passwords.verifyDummy(dto.password);
      throw new AccountLockedException(retry);
    }

    const hash = channel === 'showroom' ? user?.showroomPasswordHash : user?.passwordHash;
    const ok = await this.passwords.verify(hash, dto.password);
    if (!ok || !user) {
      const locked = await this.lockout.registerFailure(user, username, channel);
      if (locked) throw this.lockedNow();
      throw new AuthFailedException();
    }
    if (!user.isActive) {
      this.trail.addMetadata({ reason: 'inactive' });
      throw new AuthFailedException();
    }
    await this.lockout.registerSuccess(user, channel);
    return user;
  }

  private lockedNow(): AccountLockedException {
    this.trail.addMetadata({ lockedNow: true });
    return new AccountLockedException(this.config.get('LOGIN_LOCK_MINUTES', { infer: true }) * 60);
  }

  private async startSession(user: LoginUser, audience: SessionAudience, meta: RequestMeta): Promise<IssuedAuth> {
    const issued = await this.tokens.createSession(user.id, audience, meta);
    if (audience === 'DASHBOARD') {
      await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    }
    this.trail.setEntity('Session', issued.sessionId);
    return this.issue(user.id, issued, audience);
  }

  private async issue(
    userId: string,
    issued: { sessionId: string; refreshToken: string; expiresAt: Date },
    audience: SessionAudience,
  ): Promise<IssuedAuth> {
    const principal = await this.sessions.load(issued.sessionId, userId, audience);
    if (!principal) throw new AuthFailedException('SESSION_EXPIRED');
    const { accessToken, expiresIn } = await this.tokens.signAccess(principal, issued.sessionId, audience);
    const user = await this.profile(principal);
    return { accessToken, expiresIn, user, refreshToken: issued.refreshToken, refreshExpiresAt: issued.expiresAt };
  }
}

export function actorOf(u: { id: string; username: string; role: Role; branchId: string | null }) {
  return { id: u.id, username: u.username, role: u.role, branchId: u.branchId };
}

export function publicAuth(result: IssuedAuth): AuthResult {
  return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
}
