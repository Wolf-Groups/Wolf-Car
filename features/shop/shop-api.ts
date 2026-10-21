import { toApiError } from "@/lib/api/client";
import type { CustomerProfile, WebOrder } from "@/lib/api/types";

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
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c.startsWith("wc_customer="));
}

/** An order id as the API issues it (a UUID): the only `?order=` the return page and "Try another card" accept. */
export const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  email: string;
}

export const shop = {
  sendOtp(phone: string): Promise<{ expiresAt: string; devCode?: string }> {
    return shopApi("/otp", { method: "POST", json: { phone } });
  },
  verifyOtp(phone: string, code: string): Promise<{ customer: CustomerProfile; expiresAt: string }> {
    return shopApi("/otp/verify", { method: "POST", json: { phone, code } });
  },
  me(): Promise<CustomerProfile> {
    return shopApi("/me");
  },
  logout(): Promise<void> {
    return shopApi("/logout", { method: "POST" });
  },
  createOrder(body: CreateOrderBody, idempotencyKey: string): Promise<WebOrder & { replayed: boolean }> {
    return shopApi("/orders", { method: "POST", json: body, headers: { "Idempotency-Key": idempotencyKey } });
  },
  getOrder(id: string): Promise<WebOrder> {
    return shopApi(`/orders/${id}`);
  },
  pay(id: string, tokenId: string, locale: "ar" | "en"): Promise<{ redirectUrl: string | null; order: WebOrder }> {
    return shopApi(`/orders/${id}/pay`, { method: "POST", json: { tokenId, locale } });
  },
  reconcile(id: string): Promise<WebOrder> {
    return shopApi(`/orders/${id}/reconcile`, { method: "POST" });
  },
  cancel(id: string): Promise<WebOrder> {
    return shopApi(`/orders/${id}/cancel`, { method: "POST" });
  },
};
