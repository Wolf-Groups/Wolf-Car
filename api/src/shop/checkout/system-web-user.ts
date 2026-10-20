import type { Prisma, PrismaClient } from '../../generated/prisma/client';

/** The inactive account web orders are attributed to (Order.createdById is required), like system.odoo for the catalogue. */
export const SYSTEM_WEB_USERNAME = 'system.web';

/** Upserts the account (SUPER_ADMIN, inactive, unusable password hash, displayName "Website orders") and returns its id. */
export async function ensureSystemWebUser(db: Prisma.TransactionClient | PrismaClient): Promise<string> {
  const user = await db.user.upsert({
    where: { username: SYSTEM_WEB_USERNAME },
    update: {},
    create: {
      username: SYSTEM_WEB_USERNAME,
      displayName: 'Website orders',
      role: 'SUPER_ADMIN',
      // no usable password hash: this account exists for attribution only
      passwordHash: 'x'.repeat(97),
      isActive: false,
    },
    select: { id: true },
  });
  return user.id;
}
