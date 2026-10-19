import type { CustomerProfile, WebOrder } from "@/lib/api/types";
import { todo } from "./todo";

/**
 * The website's checkout has no staff token: the API reads the httpOnly
 * `wc_cst` cookie set when the phone code was verified. Like the sales page
 * (`features/bookings/slots/api.ts`) these calls send only the cookie plus
 * the CSRF header, and throw `ApiError` (via `toApiError`) on any non-2xx.
 */
export interface ShopRequestOptions {
  method?: "GET" | "POST";
  json?: unknown;
  headers?: Record<string, string>;
}

/** Set by the API next to the httpOnly cookie; only says "this browser probably has a customer session". */
export function hasCustomerHint(): boolean {
  return todo("hasCustomerHint");
}

export async function shopApi<T>(path: string, options: ShopRequestOptions = {}): Promise<T> {
  return todo("shopApi", path, options);
}

export interface CreateOrderBody {
  items: { productId: string; quantity: number }[];
  name: string;
  email: string;
}

export const shop = {
  sendOtp(phone: string): Promise<{ expiresAt: string; devCode?: string }> {
    return todo("shop.sendOtp", phone);
  },
  verifyOtp(phone: string, code: string): Promise<{ customer: CustomerProfile; expiresAt: string }> {
    return todo("shop.verifyOtp", phone, code);
  },
  me(): Promise<CustomerProfile> {
    return todo("shop.me");
  },
  logout(): Promise<void> {
    return todo("shop.logout");
  },
  createOrder(body: CreateOrderBody, idempotencyKey: string): Promise<WebOrder & { replayed: boolean }> {
    return todo("shop.createOrder", body, idempotencyKey);
  },
  getOrder(id: string): Promise<WebOrder> {
    return todo("shop.getOrder", id);
  },
  pay(id: string, tokenId: string, locale: "ar" | "en"): Promise<{ redirectUrl: string | null; order: WebOrder }> {
    return todo("shop.pay", id, tokenId, locale);
  },
  reconcile(id: string): Promise<WebOrder> {
    return todo("shop.reconcile", id);
  },
  cancel(id: string): Promise<WebOrder> {
    return todo("shop.cancel", id);
  },
};
