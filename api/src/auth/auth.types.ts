import type { PermissionKey } from '../../../shared/permissions';
import type { Role } from '../generated/prisma/client';

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  nameAr: string;
}

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  branch: BranchSummary | null;
  /** the user's branch is the one that holds website orders (WEB_ORDERS_BRANCH_CODE) */
  branchHoldsWebOrders: boolean;
  twoFactorEnabled: boolean;
  hasShowroomPassword: boolean;
  permissions: PermissionKey[];
}

export interface AuthResult {
  accessToken: string;
  /** seconds */
  expiresIn: number;
  user: Profile;
}

export interface IssuedAuth extends AuthResult {
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}
