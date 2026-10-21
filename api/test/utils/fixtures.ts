import { Prisma } from '../../src/generated/prisma/client';
import { PasswordService } from '../../src/auth/password.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { syncPermissionCatalog } from '../../src/rbac/permission-catalog';

export const PW = {
  admin: 'SuperWolf#2026!',
  finance: 'Ledger#Wolf2026!',
  manager: 'Manager#Wolf2026!',
  cashier: 'Cashier#Wolf2026!',
  showroom: 'Showroom#2026!',
  reservations: 'Booking#Wolf2026!',
} as const;

export interface BranchFixture {
  id: string;
  code: string;
  managerId: string;
  cashierId: string;
  manager: string;
  cashier: string;
}

export interface World {
  adminId: string;
  financeId: string;
  reservationsId: string;
  bo: BranchFixture;
  gh: BranchFixture;
  products: { id: string; name: string; price: string | null }[];
}

let hashes: Record<keyof typeof PW, string> | undefined;

async function passwordHashes(): Promise<Record<keyof typeof PW, string>> {
  if (!hashes) {
    const svc = new PasswordService();
    const entries = await Promise.all(Object.entries(PW).map(async ([k, v]) => [k, await svc.hash(v)] as const));
    hashes = Object.fromEntries(entries) as Record<keyof typeof PW, string>;
  }
  return hashes;
}

/**
 * Empties every table. DELETE in one transaction is much cheaper than TRUNCATE
 * for these tiny tables (TRUNCATE creates new files on disk every time); users
 * and branches go together so the deferred staffing check sees no branches.
 * The append-only activity log can only be emptied with TRUNCATE.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE activity_logs');
  await prisma.$transaction(async (tx) => {
    for (const table of [
      'site_events',
      'light_job_requests',
      'ppf_bookings',
      'ppf_closed_days',
      'general_reservations',
      'sales_access',
      'odoo_outbox',
      'payments',
      'order_items',
      'orders',
      'customer_otps',
      'customers',
      'price_history',
      'branch_products',
      'products',
      'refresh_tokens',
      'sessions',
      'recovery_codes',
      'user_permission_overrides',
      'role_permissions',
      'permissions',
      'users',
      'branches',
    ]) {
      await tx.$executeRawUnsafe(`DELETE FROM ${table}`);
    }
  });
}

/**
 * Standard world: admin, finance, branches BO and GH (manager + cashier each,
 * all with showroom passwords) and three products (two priced, one not), in
 * branch display order.
 */
export async function seedWorld(prisma: PrismaService): Promise<World> {
  await resetDatabase(prisma);
  await syncPermissionCatalog(prisma);
  const h = await passwordHashes();

  const admin = await prisma.user.create({
    data: { username: 'admin', displayName: 'Admin', role: 'SUPER_ADMIN', passwordHash: h.admin },
  });
  const finance = await prisma.user.create({
    data: { username: 'finance', displayName: 'Finance', role: 'FINANCE', passwordHash: h.finance },
  });
  const reservations = await prisma.user.create({
    data: { username: 'reservations', displayName: 'Reservations', role: 'RESERVATIONS', passwordHash: h.reservations },
  });

  const branch = async (code: string, slug: string): Promise<BranchFixture> =>
    prisma.$transaction(async (tx) => {
      const b = await tx.branch.create({ data: { code, name: `${code} Branch`, nameAr: `فرع ${code}` } });
      const m = await tx.user.create({
        data: {
          username: `${slug}.manager`,
          displayName: `${code} Manager`,
          role: 'BRANCH_MANAGER',
          branchId: b.id,
          passwordHash: h.manager,
          showroomPasswordHash: h.showroom,
        },
      });
      const c = await tx.user.create({
        data: {
          username: `${slug}.cashier`,
          displayName: `${code} Cashier`,
          role: 'CASHIER',
          branchId: b.id,
          passwordHash: h.cashier,
          showroomPasswordHash: h.showroom,
        },
      });
      return { id: b.id, code, managerId: m.id, cashierId: c.id, manager: m.username, cashier: c.username };
    });
  const bo = await branch('BO', 'bo');
  const gh = await branch('GH', 'gh');

  const defs = [
    { name: 'Dash Cam', price: '499.00', barcode: '1000000000001' },
    { name: 'Floor Mats', price: '120.50', barcode: null },
    { name: 'Phone Holder', price: null, barcode: '1000000000003' },
  ];
  const products: World['products'] = [];
  for (const d of defs) {
    const p = await prisma.product.create({
      data: {
        name: d.name,
        description: `${d.name} description`,
        barcode: d.barcode,
        imageKey: '00000000-0000-4000-8000-000000000000',
        price: d.price ? new Prisma.Decimal(d.price) : null,
        createdById: bo.managerId,
      },
    });
    products.push({ id: p.id, name: p.name, price: d.price });
  }
  for (const b of [bo, gh]) {
    await prisma.branchProduct.createMany({
      data: products.map((p, position) => ({ branchId: b.id, productId: p.id, position })),
    });
  }
  return { adminId: admin.id, financeId: finance.id, reservationsId: reservations.id, bo, gh, products };
}
