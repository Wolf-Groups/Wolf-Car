import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { server } from "@/tests/msw";
import { apiError, customer, ORDER_ID, ORDER_KEY, recordShopCalls, setCustomerHint, type ShopCall, webOrder } from "@/tests/shop-fixtures";
import { hasCustomerHint, orderPath, shop, shopApi } from "./shop-api";

afterEach(() => {
  setCustomerHint(false);
  document.cookie = "wc_slots=; path=/; max-age=0";
});

/** Answers every /api/shop call with `answer` and records what was sent. */
function listen(answer: (call: ShopCall) => Response = () => HttpResponse.json({})) {
  const calls: ShopCall[] = [];
  const record = recordShopCalls(calls);
  server.use(
    http.all("/api/shop/*", async ({ request }) => {
      await record({ request });
      return answer(calls[calls.length - 1]);
    }),
  );
  return calls;
}

describe("hasCustomerHint", () => {
  it("reads the readable wc_customer cookie the API sets next to the httpOnly one", () => {
    expect(hasCustomerHint()).toBe(false);
    document.cookie = "wc_slots=1; path=/";
    expect(hasCustomerHint()).toBe(false);
    setCustomerHint(true);
    expect(hasCustomerHint()).toBe(true);
    setCustomerHint(false);
    expect(hasCustomerHint()).toBe(false);
  });
});

describe("shopApi", () => {
  it("prefixes /api/shop and sends the CSRF header on a GET", async () => {
    const calls = listen(() => HttpResponse.json(customer()));
    await expect(shopApi("/me")).resolves.toEqual(customer());
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/shop/me");
    expect(calls[0].headers.get("x-requested-with")).toBe("wolfcar");
  });

  it("sends JSON with the CSRF header and extra headers on a POST", async () => {
    const calls = listen(() => HttpResponse.json({ ok: true }));
    await shopApi("/otp", { method: "POST", json: { email: "sara@example.com" }, headers: { "Idempotency-Key": "k-1" } });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/shop/otp");
    expect(calls[0].headers.get("x-requested-with")).toBe("wolfcar");
    expect(calls[0].headers.get("content-type")).toMatch(/^application\/json/);
    expect(calls[0].headers.get("idempotency-key")).toBe("k-1");
    expect(calls[0].body).toEqual({ email: "sara@example.com" });
  });

  it("sends the cookie only (credentials same-origin), never a staff bearer token", async () => {
    listen(() => HttpResponse.json(customer()));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await shopApi("/me");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1];
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
  });

  it("throws ApiError with the status and code on a 4xx", async () => {
    listen(() => apiError(401, "SESSION_EXPIRED"));
    const error = await shopApi("/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  });

  it("keeps retryAfterSeconds from a 429 (too many codes for one address)", async () => {
    listen(() => apiError(429, "OTP_TOO_MANY", { retryAfterSeconds: 840 }));
    const error = await shopApi("/otp", { method: "POST", json: { email: "sara@example.com" } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "OTP_TOO_MANY", retryAfterSeconds: 840 });
  });
});

describe("shop", () => {
  const order = webOrder();

  it.each([
    ["sendCode", "POST", "/api/shop/otp", { email: "sara@example.com", locale: "ar" }, () => shop.sendCode("sara@example.com", "ar")],
    ["verifyCode", "POST", "/api/shop/otp/verify", { email: "sara@example.com", code: "482915" }, () => shop.verifyCode("sara@example.com", "482915")],
    ["me", "GET", "/api/shop/me", undefined, () => shop.me()],
    ["getOrder", "GET", `/api/shop/orders/${ORDER_ID}`, undefined, () => shop.getOrder(ORDER_ID)],
    ["pay", "POST", `/api/shop/orders/${ORDER_ID}/pay`, { tokenId: "tok_fake_ok", locale: "ar" }, () => shop.pay(ORDER_ID, "tok_fake_ok", "ar")],
    ["reconcile", "POST", `/api/shop/orders/${ORDER_ID}/reconcile`, undefined, () => shop.reconcile(ORDER_ID)],
    ["cancel", "POST", `/api/shop/orders/${ORDER_ID}/cancel`, undefined, () => shop.cancel(ORDER_ID)],
  ] as const)("%s → %s %s", async (_name, method, path, body, run) => {
    const calls = listen(() => HttpResponse.json(order));
    await run();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method, path });
    expect(calls[0].headers.get("x-requested-with")).toBe("wolfcar");
    if (body !== undefined) expect(calls[0].body).toEqual(body);
  });

  it("returns what the API answered", async () => {
    listen((call) =>
      call.path.endsWith("/otp/verify")
        ? HttpResponse.json({ customer: customer(), expiresAt: "2031-04-09T09:00:00.000Z" })
        : HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z", devCode: "482915" }),
    );
    await expect(shop.sendCode("sara@example.com", "en")).resolves.toEqual({ expiresAt: "2031-03-10T09:05:00.000Z", devCode: "482915" });
    await expect(shop.verifyCode("sara@example.com", "482915")).resolves.toEqual({ customer: customer(), expiresAt: "2031-04-09T09:00:00.000Z" });
  });

  it.each([
    ["getOrder", () => shop.getOrder(ORDER_ID, ORDER_KEY)],
    ["pay", () => shop.pay(ORDER_ID, "tok_fake_ok", "ar", ORDER_KEY)],
    ["reconcile", () => shop.reconcile(ORDER_ID, ORDER_KEY)],
    ["cancel", () => shop.cancel(ORDER_ID, ORDER_KEY)],
  ] as const)("%s sends the order's key when it has one, so a guest is let in", async (_name, run) => {
    const calls = listen(() => HttpResponse.json(order));
    await run();
    expect(calls[0].headers.get("x-order-key")).toBe(ORDER_KEY);
  });

  it("sends no key header without a key (a signed-in customer's own order)", async () => {
    const calls = listen(() => HttpResponse.json(order));
    await shop.getOrder(ORDER_ID, null);
    expect(calls[0].headers.get("x-order-key")).toBeNull();
  });

  it("creates the order with the basket, contact details, how it is paid and the Idempotency-Key header", async () => {
    const calls = listen(() => HttpResponse.json({ ...order, replayed: false, key: ORDER_KEY }, { status: 201 }));
    const body = {
      items: [{ productId: "p-cam", quantity: 1 }, { productId: "p-mats", quantity: 1 }],
      name: "Sara Ali",
      phone: "+97455123456",
      email: "sara@example.com",
      paymentMethod: "branch" as const,
      locale: "ar" as const,
    };
    await expect(shop.createOrder(body, "key-123")).resolves.toEqual({ ...order, replayed: false, key: ORDER_KEY });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/shop/orders", body });
    expect(calls[0].headers.get("idempotency-key")).toBe("key-123");
    expect(calls[0].headers.get("x-requested-with")).toBe("wolfcar");
  });

  it("signs out with POST /api/shop/logout, which answers 204 with no body", async () => {
    const calls = listen(() => new HttpResponse(null, { status: 204 }));
    await expect(shop.logout()).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/shop/logout" });
    expect(calls[0].headers.get("x-requested-with")).toBe("wolfcar");
  });

  it("rejects with the API's code when the order cannot be paid", async () => {
    listen(() => apiError(409, "ORDER_NOT_PAYABLE"));
    await expect(shop.pay(ORDER_ID, "tok_fake_ok", "en")).rejects.toMatchObject({ status: 409, code: "ORDER_NOT_PAYABLE" });
  });
});

describe("orderPath", () => {
  it("carries the order and, when known, its key", () => {
    expect(orderPath("/checkout/return", ORDER_ID, ORDER_KEY)).toBe(`/checkout/return?order=${ORDER_ID}&key=${ORDER_KEY}`);
    expect(orderPath("/checkout", ORDER_ID, null)).toBe(`/checkout?order=${ORDER_ID}`);
  });
});
