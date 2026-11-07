import { mock, mockDeep } from 'jest-mock-extended';
import type { TokenService } from '../../auth/token.service';
import { AuthFailedException } from '../../common/errors';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomersService } from './customers.service';

describe('CustomersService.loadFromToken', () => {
  const prisma = mockDeep<PrismaService>();
  const tokens = mock<TokenService>();
  const service = new CustomersService(prisma, tokens);

  beforeEach(() => {
    jest.resetAllMocks();
    tokens.verifyCustomer.mockResolvedValue({ sub: 'c-1', ver: 1 } as never);
  });

  it('answers the customer of a valid cookie', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'c-1', email: 'sara@example.com', name: 'Sara', phone: null, sessionVersion: 1 } as never);
    await expect(service.loadFromToken('t')).resolves.toEqual({ id: 'c-1', email: 'sara@example.com', name: 'Sara', phone: null, sessionVersion: 1 });
  });

  it('treats a customer of the old phone sign-in, without an email, as signed out', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'c-1', email: null, name: 'Sara', phone: '+97455123456', sessionVersion: 1 } as never);
    await expect(service.loadFromToken('t')).rejects.toBeInstanceOf(AuthFailedException);
  });

  it('refuses an older session version', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'c-1', email: 'sara@example.com', name: null, phone: null, sessionVersion: 2 } as never);
    await expect(service.loadFromToken('t')).rejects.toBeInstanceOf(AuthFailedException);
  });
});
