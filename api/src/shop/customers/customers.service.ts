import { Injectable } from '@nestjs/common';
import { TokenService } from '../../auth/token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { todo } from '../todo';

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

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** 401 SESSION_EXPIRED when the cookie is missing, invalid, for an unknown customer, or an older sessionVersion. */
  loadFromToken(token: string | undefined): Promise<CustomerPrincipal> {
    return todo('CustomersService.loadFromToken', this.prisma, this.tokens, token);
  }

  /** "Sign out everywhere": bumps sessionVersion. */
  logoutAll(customerId: string): Promise<void> {
    return todo('CustomersService.logoutAll', customerId);
  }

  profile(customerId: string): Promise<CustomerProfileView> {
    return todo('CustomersService.profile', customerId);
  }
}
