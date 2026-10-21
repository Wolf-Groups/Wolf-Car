/**
 * Single source of truth for roles and permission keys, imported by both the
 * API (seeding, guards) and the web app (UI gating). The database stores the
 * actual grants; this file only defines what exists and the seeded defaults.
 */

export const ROLES = ['SUPER_ADMIN', 'FINANCE', 'BRANCH_MANAGER', 'CASHIER', 'RESERVATIONS'] as const;
export type RoleName = (typeof ROLES)[number];

/** Roles that must belong to exactly one branch (and each branch has exactly one of each). */
export const BRANCH_ROLES: readonly RoleName[] = ['BRANCH_MANAGER', 'CASHIER'];

export const PERMISSION_GROUPS = ['product', 'order', 'booking', 'admin', 'account'] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const PERMISSIONS = {
  'product.create': { group: 'product', description: 'Create products (name, image, barcode, description)' },
  'product.update.details': { group: 'product', description: 'Edit product name, image, barcode and description' },
  'product.update.price': { group: 'product', description: 'Set and change product prices' },
  'product.read': { group: 'product', description: 'View the product list, including prices and price history' },
  'product.reorder': { group: 'product', description: "Reorder the branch's showroom product list" },
  'order.create': { group: 'order', description: 'Place orders from the showroom page' },
  'order.read.branch': { group: 'order', description: "View orders of the user's own branch" },
  'order.read.all': { group: 'order', description: 'View orders of all branches' },
  'order.update': { group: 'order', description: 'Edit pending orders (customer name, quantities)' },
  'order.cancel': { group: 'order', description: 'Cancel pending orders' },
  'order.confirm': { group: 'order', description: 'Confirm pending orders (makes them immutable)' },
  'order.receipt.download': { group: 'order', description: 'Download order receipts as PDF' },
  'order.odoo.retry': { group: 'order', description: 'Send a paid web order to Odoo again after it failed' },
  'booking.ppf.read': { group: 'booking', description: 'View the PPF calendar, bookings and light-job requests' },
  'booking.ppf.manage': {
    group: 'booking',
    description: 'Add, edit and cancel PPF bookings; close and reopen days; answer requests; set the sales PIN',
  },
  'booking.general.manage': { group: 'booking', description: 'View and manage general reservations' },
  'user.manage': { group: 'admin', description: 'Create and manage user accounts' },
  'branch.manage': { group: 'admin', description: 'Create and manage branches' },
  'permission.manage': { group: 'admin', description: 'Grant or revoke permissions per role and per user' },
  'activity.read': { group: 'admin', description: 'View the activity log' },
  'analytics.read': { group: 'admin', description: 'View website visitor statistics' },
  'showroom.password.view_or_change': {
    group: 'account',
    description: 'Manage own showroom credentials (change the showroom password)',
  },
} as const satisfies Record<string, { group: PermissionGroup; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/**
 * Seeded defaults. SUPER_ADMIN is not listed: it always holds every permission
 * and cannot be edited, so nobody can lock the system out of administration.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Exclude<RoleName, 'SUPER_ADMIN'>, PermissionKey[]> = {
  FINANCE: ['product.read', 'product.update.price', 'order.read.all', 'order.odoo.retry'],
  BRANCH_MANAGER: [
    'product.create',
    'product.update.details',
    'product.read',
    'product.reorder',
    'order.create',
    'order.read.branch',
    'showroom.password.view_or_change',
  ],
  CASHIER: [
    'order.create',
    'order.read.branch',
    'order.update',
    'order.cancel',
    'order.confirm',
    'order.receipt.download',
    'showroom.password.view_or_change',
  ],
  RESERVATIONS: ['booking.ppf.read', 'booking.ppf.manage', 'booking.general.manage'],
};

export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type OrderStatusName = (typeof ORDER_STATUSES)[number];
