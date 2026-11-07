import type { Prisma } from '../../generated/prisma/client';
import type { CustomerPrincipal } from '../customers/customers.service';
import { validOrderKey } from './order-key';

/** Who asks for a web order: the signed-in customer (cookie), the holder of its key (X-Order-Key), both, or neither. */
export interface OrderAccess {
  customer: CustomerPrincipal | null;
  key: string | null;
}

/**
 * The orders `access` may open with this id: any order its key belongs to,
 * else the signed-in customer's own; null (nothing, answered as 404) without either.
 */
export function orderAccessWhere(access: OrderAccess, orderId: string, secret: string): Prisma.OrderWhereInput | null {
  if (validOrderKey(orderId, access.key, secret)) return { id: orderId };
  if (access.customer) return { id: orderId, customerId: access.customer.id };
  return null;
}
