import { toApiError } from "@/lib/api/client";
import type { CustomerCar, CustomerProfile, WebOrder } from "@/lib/api/types";
import type { PaymentMethod } from "@/shared/shop";

/**
 * The website's checkout has no staff token: the API reads the httpOnly
 * `wc_cst` cookie set when the email code was verified, or, for a guest's
 * order, the order's key in `X-Order-Key`. Like the sales page
 * (`features/bookings/slots/api.ts`) these calls send only the cookie plus
 * the CSRF header, and throw `ApiError` (via `toApiError`) on any non-2xx.
 */
export interface ShopRequestOptions {
  method?: "GET" | "POST" | "PUT";
  json?: unknown;
  headers?: Record<string, string>;
}

/** Set by the API next to the httpOnly cookie; only says "this browser probably has a customer session". */
export function hasCustomerHint(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c.startsWith("wc_customer="));
}

/** An order id as the API issues it (a UUID): the only `?order=` the return page and "Try another card" accept. */
export const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "/checkout/return?order=<id>&key=<key>": a page for one order, with its key when there is one (a guest's). */
export function orderPath(path: string, orderId: string, key: string | null): string {
  return `${path}?order=${orderId}${key ? `&key=${key}` : ""}`;
}

/** The header that lets a guest in to their own order. */
const withKey = (key: string | null | undefined): Record<string, string> => (key ? { "X-Order-Key": key } : {});

const CSRF = { "X-Requested-With": "wolfcar" };

export async function shopApi<T>(path: string, options: ShopRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...CSRF, ...options.headers };
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/shop${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CreateOrderBody {
  items: { productId: string; quantity: number }[];
  name: string;
  /** E.164: for the branch to call */
  phone: string;
  email: string;
  paymentMethod: PaymentMethod;
  /** the language of the order's emails */
  locale: "ar" | "en";
}

export const shop = {
  /** Emails a sign-in code; `devCode` comes back only from a development API. */
  sendCode(email: string, locale: "ar" | "en"): Promise<{ expiresAt: string; devCode?: string }> {
    return shopApi("/otp", { method: "POST", json: { email, locale } });
  },
  verifyCode(email: string, code: string): Promise<{ customer: CustomerProfile; expiresAt: string }> {
    return shopApi("/otp/verify", { method: "POST", json: { email, code } });
  },
  me(): Promise<CustomerProfile> {
    return shopApi("/me");
  },
  /** The car models the customer drives, in their order. */
  myCars(): Promise<CustomerCar[]> {
    return shopApi("/me/cars");
  },
  /** Replaces the list (at most 5); answers the saved list. */
  saveCars(categoryIds: string[]): Promise<CustomerCar[]> {
    return shopApi("/me/cars", { method: "PUT", json: { categoryIds } });
  },
  logout(): Promise<void> {
    return shopApi("/logout", { method: "POST" });
  },
  /** Signed in or not; the answer carries the key that opens the order without a session. */
  createOrder(body: CreateOrderBody, idempotencyKey: string): Promise<WebOrder & { replayed: boolean; key: string }> {
    return shopApi("/orders", { method: "POST", json: body, headers: { "Idempotency-Key": idempotencyKey } });
  },
  /** The signed-in customer's orders, newest first (abandoned checkouts left out). */
  listOrders(): Promise<WebOrder[]> {
    return shopApi("/orders");
  },
  /** By the customer's cookie, or by the order's key (a guest). */
  getOrder(id: string, key?: string | null): Promise<WebOrder> {
    return shopApi(`/orders/${id}`, { headers: withKey(key) });
  },
  pay(id: string, tokenId: string, locale: "ar" | "en", key?: string | null): Promise<{ redirectUrl: string | null; order: WebOrder }> {
    return shopApi(`/orders/${id}/pay`, { method: "POST", json: { tokenId, locale }, headers: withKey(key) });
  },
  reconcile(id: string, key?: string | null): Promise<WebOrder> {
    return shopApi(`/orders/${id}/reconcile`, { method: "POST", headers: withKey(key) });
  },
  cancel(id: string, key?: string | null): Promise<WebOrder> {
    return shopApi(`/orders/${id}/cancel`, { method: "POST", headers: withKey(key) });
  },
};
