import { HttpResponse } from "msw";
import { vi } from "vitest";
import type { CardSdk, TapToken } from "@/features/shop/tap-sdk";
import type { CustomerProfile, WebOrder } from "@/lib/api/types";

/** Shared data for the website checkout tests (features/shop). */
export const ORDER_ID = "00000000-0000-4000-8000-0000000000a1";
export const CART_KEY = "wolfcar.cart.v1";
export const HINT_COOKIE = "wc_customer";

export function customer(over: Partial<CustomerProfile> = {}): CustomerProfile {
  return { phone: "+97455123456", name: "Sara Ali", email: "sara@example.com", ...over };
}

/** An unpaid web order of Dash Cam ×1 + Floor Mats ×1 (the API e2e's basket). */
export function webOrder(over: Partial<WebOrder> = {}): WebOrder {
  return {
    id: ORDER_ID,
    code: "BO-000001",
    status: "PENDING",
    paymentStatus: "PENDING",
    total: "619.50",
    currency: "QAR",
    createdAt: "2031-03-10T09:00:00.000Z",
    expiresAt: "2031-03-10T09:30:00.000Z",
    paidAt: null,
    collectedAt: null,
    branch: { code: "BO", name: "Bin Omran Branch", nameAr: "فرع بن عمران" },
    customer: { name: "Sara Ali", email: "sara@example.com", phone: "+97455123456" },
    items: [
      { productId: "p-cam", productName: "4K Dash Cam (Front & Rear)", unitPrice: "499.00", quantity: 1, lineTotal: "499.00", thumbUrl: "/api/uploads/cam-sm.webp" },
      { productId: "p-mats", productName: "3D Floor Mats", unitPrice: "120.50", quantity: 1, lineTotal: "120.50", thumbUrl: "/api/uploads/mats-sm.webp" },
    ],
    lastPayment: null,
    ...over,
  };
}

export function paidOrder(over: Partial<WebOrder> = {}): WebOrder {
  return webOrder({
    status: "CONFIRMED",
    paymentStatus: "PAID",
    paidAt: "2031-03-10T09:05:00.000Z",
    lastPayment: { status: "CAPTURED", failureCode: null },
    ...over,
  });
}

/** The API's error body, as the global exception filter sends it. */
export function apiError(status: number, code: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json({ statusCode: status, code, message: code, ...extra }, { status });
}

export function setCustomerHint(on: boolean): void {
  document.cookie = on ? `${HINT_COOKIE}=1; path=/` : `${HINT_COOKIE}=; path=/; max-age=0`;
}

/** The cart lines the details step turns into the order body. */
export const CART_PRODUCTS = [
  { id: "p-cam", name: "4K Dash Cam (Front & Rear)", price: "499.00", thumbUrl: "/api/uploads/cam-sm.webp" },
  { id: "p-mats", name: "3D Floor Mats", price: "120.50", thumbUrl: "/api/uploads/mats-sm.webp" },
] as const;

/** Everything the API was asked under /api/shop, in order. */
export interface ShopCall {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

export function recordShopCalls(calls: ShopCall[]) {
  return async ({ request }: { request: Request }) => {
    const text = await request.clone().text();
    calls.push({ method: request.method, path: new URL(request.url).pathname, headers: request.headers, body: text ? (JSON.parse(text) as unknown) : undefined });
  };
}

/**
 * A stand-in for Tap's Card SDK on window.CardSDK: keeps the config the card
 * was rendered with, answers tokenize() with `token` (or an error) on the
 * next microtask, and calls onReady once rendered, as the real SDK does.
 */
export function stubCardSdk({ token = { id: "tok_fake_ok", card: { last_four: "0010", brand: "VISA" } }, fail }: { token?: TapToken; fail?: string } = {}) {
  const state: { config: Record<string, unknown> | null } = { config: null };
  const unmount = vi.fn();
  const call = (name: "onReady" | "onSuccess" | "onError" | "onValidInput" | "onInvalidInput", arg?: unknown) => {
    const fn = state.config?.[name];
    if (typeof fn === "function") (fn as (value?: unknown) => void)(arg);
  };
  const sdk: CardSdk = {
    renderTapCard: vi.fn((containerId: string, config: Record<string, unknown>) => {
      state.config = config;
      // Tap's own frame, with its English title (the page renames it once the form is ready)
      document.getElementById(containerId)?.insertAdjacentHTML("beforeend", '<iframe id="tap-card-iframe" title="Secure payment input"></iframe>');
      queueMicrotask(() => call("onReady"));
      return { unmount };
    }),
    tokenize: vi.fn(() => {
      queueMicrotask(() => (fail ? call("onError", fail) : call("onSuccess", token)));
    }),
    updateTheme: vi.fn(),
    resetCardInputs: vi.fn(),
  };
  window.CardSDK = sdk;
  return { sdk, unmount, state, call };
}

export function removeCardSdk(): void {
  delete window.CardSDK;
}
