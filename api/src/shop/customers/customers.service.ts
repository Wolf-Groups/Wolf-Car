import { Injectable } from '@nestjs/common';
import { TokenService } from '../../auth/token.service';
import { AuthFailedException } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';

/** The signed-in website customer, attached to the request by CustomerGuard. */
export interface CustomerPrincipal {
  id: string;
  /** what they signed in with, lower-case */
  email: string;
  name: string | null;
  /** last typed at checkout, E.164 */
  phone: string | null;
  sessionVersion: number;
}

export interface CustomerProfileView {
  email: string;
  name: string | null;
  phone: string | null;
}

export const CUSTOMER_PRINCIPAL_SELECT = { id: true, email: true, name: true, phone: true, sessionVersion: true } as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * 401 SESSION_EXPIRED when the cookie is missing, invalid, for an unknown customer, or an older
   * sessionVersion; also for a customer of the old phone sign-in, who has no email to sign in with.
   */
  async loadFromToken(token: string | undefined): Promise<CustomerPrincipal> {
    if (!token) throw new AuthFailedException('SESSION_EXPIRED');
    const { sub, ver } = await this.tokens.verifyCustomer(token);
    const customer = await this.prisma.customer.findUnique({ where: { id: sub }, select: CUSTOMER_PRINCIPAL_SELECT });
    if (!customer?.email || customer.sessionVersion !== ver) throw new AuthFailedException('SESSION_EXPIRED');
    return { ...customer, email: customer.email };
  }

  /** "Sign out everywhere": bumps sessionVersion. */
  async logoutAll(customerId: string): Promise<void> {
    await this.prisma.customer.update({ where: { id: customerId }, data: { sessionVersion: { increment: 1 } } });
  }

  async profile(customerId: string): Promise<CustomerProfileView> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { email: true, name: true, phone: true } });
    if (!customer?.email) throw new AuthFailedException('SESSION_EXPIRED');
    return { ...customer, email: customer.email };
  }
}
