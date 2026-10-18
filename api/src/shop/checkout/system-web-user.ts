import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { todo } from '../todo';

/** The inactive account web orders are attributed to (Order.createdById is required), like system.odoo for the catalogue. */
export const SYSTEM_WEB_USERNAME = 'system.web';

/** Upserts the account (SUPER_ADMIN, inactive, unusable password hash, displayName "Website orders") and returns its id. */
export function ensureSystemWebUser(db: Prisma.TransactionClient | PrismaClient): Promise<string> {
  return todo('ensureSystemWebUser', db);
}
