import type { AuthUser } from '../common/types';
import type { Prisma } from '../generated/prisma/client';

/** Matches nothing: used when a user has no branch to be scoped to. */
const NOTHING: Prisma.OrderWhereInput = { id: { in: [] } };

/**
 * Which orders a user may READ. Branch-scoped users only ever see their own
 * branch, whatever filters or ids they send — a foreign id behaves like a
 * missing one (404).
 */
export function orderReadScope(user: AuthUser): Prisma.OrderWhereInput {
  if (canReadAllBranches(user)) return {};
  if (user.branchId && user.permissions.has('order.read.branch')) return { branchId: user.branchId };
  return NOTHING;
}

/** Receipts: every order for users who can read all branches, otherwise the user's own branch. */
export function orderReceiptScope(user: AuthUser): Prisma.OrderWhereInput {
  if (canReadAllBranches(user)) return {};
  return user.branchId ? { branchId: user.branchId } : NOTHING;
}

/**
 * Which orders a user may CHANGE (update, confirm, cancel, collect): own branch only; Super Admin everywhere;
 * order.web.handle (the call center) adds the website's orders of every branch, never a showroom's.
 */
export function orderWriteScope(user: AuthUser): Prisma.OrderWhereInput {
  if (user.role === 'SUPER_ADMIN') return {};
  const own: Prisma.OrderWhereInput | null = user.branchId ? { branchId: user.branchId } : null;
  if (!user.permissions.has('order.web.handle')) return own ?? NOTHING;
  return own ? { OR: [own, { source: 'WEB' }] } : { source: 'WEB' };
}

/** order.web.handle reads every order too: the website's to work on, the showroom's to look at. */
export const canReadAllBranches = (user: AuthUser) =>
  user.role === 'SUPER_ADMIN' || user.permissions.has('order.read.all') || user.permissions.has('order.web.handle');
