import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { mock, mockDeep } from 'jest-mock-extended';
import type { ActivityService } from '../activity/activity.service';
import { sha256Hex } from '../common/crypto';
import { AuthFailedException } from '../common/errors';
import type { PrismaService } from '../prisma/prisma.service';
import { JWT_ISSUER, TokenService } from './token.service';

const config = new ConfigService({ JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TTL_DAYS: 7, SHOWROOM_SESSION_TTL_HOURS: 16, CUSTOMER_SESSION_TTL_DAYS: 30 });
const jwt = new JwtService({
  secret: 'unit-test-secret-unit-test-secret-1234',
  signOptions: { issuer: JWT_ISSUER, algorithm: 'HS256' },
  verifyOptions: { issuer: JWT_ISSUER, algorithms: ['HS256'] },
});
const meta = { ip: '127.0.0.1', userAgent: 'jest' };

function storedToken(overrides: { usedAt?: Date | null; revokedAt?: Date | null; expiresAt?: Date; audience?: 'DASHBOARD' | 'SHOWROOM' } = {}) {
  return {
    id: 'rt-1',
    sessionId: 's-1',
    tokenHash: 'h',
    expiresAt: new Date(Date.now() + 1e6),
    usedAt: overrides.usedAt ?? null,
    createdAt: new Date(),
    session: {
      id: 's-1',
      userId: 'u-1',
      audience: overrides.audience ?? 'DASHBOARD',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 1e6),
      revokedAt: overrides.revokedAt ?? null,
      user: { id: 'u-1', username: 'gh.cashier', role: 'CASHIER', branchId: 'b-1' },
    },
  };
}

describe('TokenService', () => {
  const prisma = mockDeep<PrismaService>();
  const activity = mock<ActivityService>();
  const service = new TokenService(jwt, prisma, config as never, activity);
  beforeEach(() => jest.resetAllMocks());

  it('signs access tokens with the session audience and verifies them', async () => {
    const { accessToken, expiresIn } = await service.signAccess({ id: 'u-1', role: 'CASHIER', branchId: 'b-1' }, 's-1', 'SHOWROOM');
    expect(expiresIn).toBe(900);
    await expect(service.verifyAccess(accessToken)).resolves.toMatchObject({ sub: 'u-1', sid: 's-1', aud: 'showroom', bid: 'b-1' });
  });

  it('keeps 2FA challenge tokens and access tokens apart', async () => {
    const challenge = await service.signChallenge('u-1');
    await expect(service.verifyAccess(challenge)).rejects.toThrow();
    await expect(service.verifyChallenge(challenge)).resolves.toBe('u-1');
    const { accessToken } = await service.signAccess({ id: 'u-1', role: 'CASHIER', branchId: null }, 's-1', 'DASHBOARD');
    await expect(service.verifyChallenge(accessToken)).rejects.toBeInstanceOf(AuthFailedException);
  });

  it('stores only the hash of new refresh tokens', async () => {
    prisma.session.create.mockResolvedValue({ id: 's-9' } as never);
    const issued = await service.createSession('u-1', 'DASHBOARD', meta);
    const data = prisma.session.create.mock.calls[0][0].data as { refreshTokens: { create: { tokenHash: string } } };
    expect(data.refreshTokens.create.tokenHash).toBe(sha256Hex(issued.refreshToken));
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
  });

  it('rejects unknown, revoked, expired and wrong-audience tokens', async () => {
    for (const token of [
      null,
      storedToken({ revokedAt: new Date() }),
      storedToken({ expiresAt: new Date(Date.now() - 1) }),
      storedToken({ audience: 'SHOWROOM' }),
    ]) {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(token as never);
      await expect(service.rotate('raw', 'DASHBOARD', meta)).rejects.toBeInstanceOf(AuthFailedException);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('revokes the whole session when a used token is replayed after the grace window', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(storedToken({ usedAt: new Date(Date.now() - 60_000) }) as never);
    await expect(service.rotate('raw', 'DASHBOARD', meta)).rejects.toBeInstanceOf(AuthFailedException);
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's-1', revokedAt: null }, data: expect.objectContaining({ revokeReason: 'refresh_reuse' }) }),
    );
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.refresh.reuse_detected' }));
  });

  it('treats a just-used token (two tabs refreshing at once) as benign', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(storedToken({ usedAt: new Date(Date.now() - 2_000) }) as never);
    await expect(service.rotate('raw', 'DASHBOARD', meta)).rejects.toBeInstanceOf(AuthFailedException);
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('rotates a valid token within the same session', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(storedToken() as never);
    const tx = mockDeep<PrismaService>();
    tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((fn: unknown) => (fn as (t: unknown) => unknown)(tx) as never);
    const rotated = await service.rotate('raw', 'DASHBOARD', meta);
    expect(rotated).toMatchObject({ sessionId: 's-1', userId: 'u-1' });
    expect(tx.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionId: 's-1', tokenHash: sha256Hex(rotated.refreshToken) }),
    });
  });

  describe('sales slots token', () => {
    it('carries the PIN version and lasts 90 days', async () => {
      const before = Date.now();
      const { token, expiresAt } = await service.signSlots(7);
      expect(await service.verifySlots(token)).toBe(7);
      expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(90 * 86_400_000 - 1000);
    });

    it('is not an access token, and an access token is not a slots token', async () => {
      const { token } = await service.signSlots(1);
      await expect(service.verifyAccess(token)).rejects.toThrow();
      const { accessToken } = await service.signAccess({ id: 'u-1', role: 'SUPER_ADMIN', branchId: null }, 's-1', 'DASHBOARD');
      expect(await service.verifySlots(accessToken)).toBeNull();
      expect(await service.verifySlots('not-a-token')).toBeNull();
    });
  });

  describe('website customer token', () => {
    it('carries the customer id and session version and lasts CUSTOMER_SESSION_TTL_DAYS', async () => {
      const before = Date.now();
      const { token, expiresAt } = await service.signCustomer('c-1', 3);
      await expect(service.verifyCustomer(token)).resolves.toMatchObject({ sub: 'c-1', ver: 3 });
      expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 86_400_000 - 2_000);
      expect(expiresAt.getTime() - before).toBeLessThanOrEqual(30 * 86_400_000 + 2_000);
    });

    it('reads the lifetime from CUSTOMER_SESSION_TTL_DAYS', async () => {
      const weekConfig = new ConfigService({ JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TTL_DAYS: 7, SHOWROOM_SESSION_TTL_HOURS: 16, CUSTOMER_SESSION_TTL_DAYS: 7 });
      const week = new TokenService(jwt, prisma, weekConfig as never, activity);
      const before = Date.now();
      const { token, expiresAt } = await week.signCustomer('c-1', 1);
      expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(7 * 86_400_000 - 2_000);
      expect(expiresAt.getTime() - before).toBeLessThanOrEqual(7 * 86_400_000 + 2_000);
      await expect(week.verifyCustomer(token)).resolves.toMatchObject({ sub: 'c-1', ver: 1 });
    });

    it('opens no staff route, and no staff token opens a customer route', async () => {
      const { token } = await service.signCustomer('c-1', 1);
      await expect(service.verifyAccess(token)).rejects.toThrow();
      await expect(service.verifyChallenge(token)).rejects.toBeInstanceOf(AuthFailedException);
      const { accessToken } = await service.signAccess({ id: 'u-1', role: 'SUPER_ADMIN', branchId: null }, 's-1', 'DASHBOARD');
      await expect(service.verifyCustomer(accessToken)).rejects.toBeInstanceOf(AuthFailedException);
      await expect(service.verifyCustomer('not-a-token')).rejects.toBeInstanceOf(AuthFailedException);
      await expect(service.verifyCustomer('not-a-token')).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
      const { token: slots } = await service.signSlots(1);
      await expect(service.verifyCustomer(slots)).rejects.toBeInstanceOf(AuthFailedException);
    });
  });
});
