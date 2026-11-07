import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock, mockDeep } from 'jest-mock-extended';
import type { PermissionKey } from '../../../shared/permissions';
import type { AuditTrail } from '../activity/audit-trail.service';
import { AccountLockedException, AuthFailedException } from '../common/errors';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { LockoutService } from './lockout.service';
import type { PasswordService } from './password.service';
import type { SessionUserService } from './session-user.service';
import type { ShowroomPinService } from './showroom-pin.service';
import type { TokenService } from './token.service';
import type { TwoFactorService } from './two-factor.service';

const meta = { ip: '127.0.0.1', userAgent: 'jest' };
const baseUser = {
  id: 'u-1',
  username: 'gh.manager',
  role: 'BRANCH_MANAGER' as const,
  branchId: 'b-1',
  isActive: true,
  passwordHash: 'hash',
  showroomPasswordHash: 'showroom-hash',
  twoFactorEnabled: false,
  failedLoginCount: 0,
  lockedUntil: null,
  showroomFailedCount: 0,
  showroomLockedUntil: null,
  branch: { isActive: true },
};

describe('AuthService', () => {
  const prisma = mockDeep<PrismaService>();
  const passwords = mock<PasswordService>();
  const tokens = mock<TokenService>();
  const lockout = mock<LockoutService>();
  const twoFactor = mock<TwoFactorService>();
  const sessions = mock<SessionUserService>();
  const pins = mock<ShowroomPinService>();
  const trail = mock<AuditTrail>();
  const config = new ConfigService({ LOGIN_LOCK_MINUTES: 15, WEB_ORDERS_BRANCH_CODE: 'BO' });
  const service = new AuthService(prisma, passwords, tokens, lockout, twoFactor, sessions, pins, trail, config as never);

  const principal = (permissions: PermissionKey[] = []) => ({
    id: 'u-1',
    username: 'gh.manager',
    displayName: 'M',
    role: 'BRANCH_MANAGER' as const,
    branchId: 'b-1',
    sessionId: 's-1',
    audience: 'DASHBOARD' as const,
    permissions: new Set(permissions),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    trail.setActor.mockReturnValue(trail);
    trail.addMetadata.mockReturnValue(trail);
    trail.setEntity.mockReturnValue(trail);
    lockout.retryAfter.mockReturnValue(0);
    tokens.createSession.mockResolvedValue({ sessionId: 's-1', refreshToken: 'rt', expiresAt: new Date() });
    tokens.signAccess.mockResolvedValue({ accessToken: 'at', expiresIn: 900 });
    sessions.load.mockResolvedValue(principal(['product.read']));
    prisma.user.findUniqueOrThrow.mockResolvedValue({ ...baseUser, displayName: 'M', email: null, branch: null } as never);
  });

  it('signs in with the right password and returns a session', async () => {
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    passwords.verify.mockResolvedValue(true);
    const result = await service.login({ username: 'gh.manager', password: 'pw' }, meta);
    expect(result).toMatchObject({ accessToken: 'at', refreshToken: 'rt', user: { permissions: ['product.read'] } });
    expect(passwords.verify).toHaveBeenCalledWith('hash', 'pw');
    expect(lockout.registerSuccess).toHaveBeenCalled();
    expect(tokens.createSession).toHaveBeenCalledWith('u-1', 'DASHBOARD', meta);
  });

  it('gives the same 401 for unknown users and wrong passwords', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(false);
    const unknown = service.login({ username: 'nobody', password: 'pw' }, meta);
    await expect(unknown).rejects.toBeInstanceOf(AuthFailedException);

    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    await expect(service.login({ username: 'gh.manager', password: 'bad' }, meta)).rejects.toBeInstanceOf(AuthFailedException);
    expect(lockout.registerFailure).toHaveBeenCalledTimes(2);
  });

  it('returns 423 once the account is locked, even with the right password', async () => {
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    lockout.retryAfter.mockReturnValue(600);
    await expect(service.login({ username: 'gh.manager', password: 'pw' }, meta)).rejects.toBeInstanceOf(AccountLockedException);
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('locks on the failure that reaches the limit', async () => {
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    passwords.verify.mockResolvedValue(false);
    lockout.registerFailure.mockResolvedValue(true);
    await expect(service.login({ username: 'gh.manager', password: 'bad' }, meta)).rejects.toBeInstanceOf(AccountLockedException);
  });

  it('rejects deactivated accounts with the generic error', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...baseUser, isActive: false } as never);
    passwords.verify.mockResolvedValue(true);
    await expect(service.login({ username: 'gh.manager', password: 'pw' }, meta)).rejects.toBeInstanceOf(AuthFailedException);
    expect(tokens.createSession).not.toHaveBeenCalled();
  });

  it('asks for the second factor when 2FA is on', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...baseUser, twoFactorEnabled: true } as never);
    passwords.verify.mockResolvedValue(true);
    tokens.signChallenge.mockResolvedValue('challenge');
    await expect(service.login({ username: 'gh.manager', password: 'pw' }, meta)).resolves.toEqual({
      twoFactorRequired: true,
      challengeToken: 'challenge',
    });
    expect(tokens.createSession).not.toHaveBeenCalled();
  });

  it('completes 2FA with a valid code and counts invalid codes as failures', async () => {
    tokens.verifyChallenge.mockResolvedValue('u-1');
    prisma.user.findFirst.mockResolvedValue({ ...baseUser, twoFactorEnabled: true } as never);
    twoFactor.verifyCode.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(service.loginTwoFactor({ challengeToken: 'c', code: '123456' }, meta)).rejects.toBeInstanceOf(AuthFailedException);
    expect(lockout.registerFailure).toHaveBeenCalledTimes(1);
    await expect(service.loginTwoFactor({ challengeToken: 'c', code: '123456' }, meta)).resolves.toMatchObject({ accessToken: 'at' });
  });

  it('accepts a recovery code instead of a TOTP code', async () => {
    tokens.verifyChallenge.mockResolvedValue('u-1');
    prisma.user.findFirst.mockResolvedValue({ ...baseUser, twoFactorEnabled: true } as never);
    twoFactor.useRecoveryCode.mockResolvedValue(true);
    await service.loginTwoFactor({ challengeToken: 'c', recoveryCode: 'abcde-fghij' }, meta);
    expect(twoFactor.useRecoveryCode).toHaveBeenCalledWith('u-1', 'abcde-fghij');
    expect(twoFactor.verifyCode).not.toHaveBeenCalled();
  });

  it('checks the showroom password (not the dashboard one) for the kiosk', async () => {
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    passwords.verify.mockResolvedValue(true);
    sessions.permissionsFor.mockResolvedValue(new Set(['order.create']));
    await service.showroomLogin({ username: 'gh.manager', password: 'pw' }, meta);
    expect(passwords.verify).toHaveBeenCalledWith('showroom-hash', 'pw');
    expect(tokens.createSession).toHaveBeenCalledWith('u-1', 'SHOWROOM', meta);
  });

  it('refuses the showroom without order.create or without a branch', async () => {
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    passwords.verify.mockResolvedValue(true);
    sessions.permissionsFor.mockResolvedValue(new Set());
    await expect(service.showroomLogin({ username: 'gh.manager', password: 'pw' }, meta)).rejects.toBeInstanceOf(ForbiddenException);

    prisma.user.findFirst.mockResolvedValue({ ...baseUser, branchId: null, branch: null } as never);
    sessions.permissionsFor.mockResolvedValue(new Set(['order.create']));
    await expect(service.showroomLogin({ username: 'gh.manager', password: 'pw' }, meta)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tokens.createSession).not.toHaveBeenCalled();
  });

  it('signs a showroom screen in as the branch\'s cashier once the branch PIN checks out', async () => {
    trail.setBranch.mockReturnValue(trail);
    prisma.user.findFirst.mockResolvedValue({ ...baseUser, role: 'CASHIER' } as never);
    sessions.permissionsFor.mockResolvedValue(new Set(['order.create']));

    await service.showroomPinLogin({ branchId: 'b-1', pin: '482913' }, meta);
    expect(pins.check).toHaveBeenCalledWith('b-1', '482913');
    expect(prisma.user.findFirst.mock.calls[0][0]?.where).toEqual({ branchId: 'b-1', role: 'CASHIER', deletedAt: null, isActive: true });
    expect(tokens.createSession).toHaveBeenCalledWith('u-1', 'SHOWROOM', meta);
  });

  it('opens no session when the PIN is wrong, or the branch has no cashier who may place orders', async () => {
    trail.setBranch.mockReturnValue(trail);
    pins.check.mockRejectedValueOnce(new Error('wrong pin'));
    await expect(service.showroomPinLogin({ branchId: 'b-1', pin: '000000' }, meta)).rejects.toThrow('wrong pin');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();

    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.showroomPinLogin({ branchId: 'b-1', pin: '482913' }, meta)).rejects.toBeInstanceOf(ForbiddenException);

    prisma.user.findFirst.mockResolvedValue({ ...baseUser, role: 'CASHIER' } as never);
    sessions.permissionsFor.mockResolvedValue(new Set());
    await expect(service.showroomPinLogin({ branchId: 'b-1', pin: '482913' }, meta)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tokens.createSession).not.toHaveBeenCalled();
  });

  it('tells the profile whether the user\'s branch is the one that holds website orders', async () => {
    const onBranch = (code: string | null) =>
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...baseUser,
        displayName: 'M',
        email: null,
        branch: code && { id: 'b-1', code, name: code, nameAr: code },
      } as never);
    onBranch('BO');
    expect((await service.profile(principal())).branchHoldsWebOrders).toBe(true);
    onBranch('GH');
    expect((await service.profile(principal())).branchHoldsWebOrders).toBe(false);
    // the call center and Finance belong to no branch
    onBranch(null);
    expect((await service.profile(principal())).branchHoldsWebOrders).toBe(false);
  });

  it('logout revokes the session behind the cookie and ignores unknown cookies', async () => {
    await service.logout(undefined);
    tokens.sessionIdForRefreshToken.mockResolvedValueOnce(null);
    await service.logout('unknown');
    expect(tokens.revokeSession).not.toHaveBeenCalled();
    tokens.sessionIdForRefreshToken.mockResolvedValueOnce('s-7');
    prisma.session.findUnique.mockResolvedValue({ user: { id: 'u-1', username: 'x', role: 'CASHIER', branchId: 'b' } } as never);
    await service.logout('known');
    expect(tokens.revokeSession).toHaveBeenCalledWith('s-7', 'logout');
  });
});
