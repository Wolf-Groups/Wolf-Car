import { Injectable } from '@nestjs/common';
import { TokenService } from '../../auth/token.service';
import { AuthFailedException } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';

/** The signed-in website customer, attached to the request by CustomerGuard. */
export interface CustomerPrincipal {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  sessionVersion: number;
}

export interface CustomerProfileView {
  phone: string;
  name: string | null;
  email: string | null;
}

export const CUSTOMER_PRINCIPAL_SELECT = { id: true, phone: true, name: true, email: true, sessionVersion: true } as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** 401 SESSION_EXPIRED when the cookie is missing, invalid, for an unknown customer, or an older sessionVersion. */
  async loadFromToken(token: string | undefined): Promise<CustomerPrincipal> {
    if (!token) throw new AuthFailedException('SESSION_EXPIRED');
    const { sub, ver } = await this.tokens.verifyCustomer(token);
    const customer = await this.prisma.customer.findUnique({ where: { id: sub }, select: CUSTOMER_PRINCIPAL_SELECT });
    if (!customer || customer.sessionVersion !== ver) throw new AuthFailedException('SESSION_EXPIRED');
    return customer;
  }

  /** "Sign out everywhere": bumps sessionVersion. */
  async logoutAll(customerId: string): Promise<void> {
    await this.prisma.customer.update({ where: { id: customerId }, data: { sessionVersion: { increment: 1 } } });
  }

  async profile(customerId: string): Promise<CustomerProfileView> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { phone: true, name: true, email: true } });
    if (!customer) throw new AuthFailedException('SESSION_EXPIRED');
    return customer;
  }
}
