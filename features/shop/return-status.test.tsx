import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cart } from "@/features/catalog/cart";
import { getBranches } from "@/lib/branches";
import { track } from "@/lib/track";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { router } from "@/tests/setup";
import { apiError, CART_KEY, CART_PRODUCTS, ORDER_ID, paidOrder, webOrder } from "@/tests/shop-fixtures";
import { CHECKOUT_POLL_MAX_MS, CHECKOUT_POLL_MS } from "@/shared/shop";
import type { WebOrder } from "@/lib/api/types";
import { ReturnStatus } from "./return-status";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

const pending = () => webOrder({ lastPayment: { status: "INITIATED", failureCode: null } });
const storedCart = () => JSON.parse(localStorage.getItem(CART_KEY) ?? "[]") as unknown[];
/** event names as strings: order_paid joins SiteEventType with plan Task 1 (shared/analytics.ts) */
const tracked = (): string[] => vi.mocked(track).mock.calls.map((c) => c[0]);

/** Answers reconcile and the polls; each answer may be a function of how often it was asked. */
function listen({ reconcile, poll }: { reconcile: (n: number) => Response; poll?: (n: number) => Response }) {
  const calls = { reconcile: 0, poll: 0 };
  server.use(
    http.post(`/api/shop/orders/${ORDER_ID}/reconcile`, () => reconcile(++calls.reconcile)),
    http.get(`/api/shop/orders/${ORDER_ID}`, () => (poll ?? (() => apiError(500, "server")))(++calls.poll)),
  );
  return calls;
}
const json = (order: WebOrder) => HttpResponse.json(order);
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  act(() => {
    cart.clear();
    cart.add(CART_PRODUCTS[0]);
  });
});
afterEach(() => {
  vi.useRealTimers();
  act(() => cart.clear());
  // the page remembers per tab which orders it already reported paid
  sessionStorage.clear();
});

describe("checkout return page", () => {
  it("asks Tap once through reconcile, then polls the order every CHECKOUT_POLL_MS while it is pending", async () => {
    const calls = listen({ reconcile: () => json(pending()), poll: () => json(pending()) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);

    expect(await screen.findByText("Checking your payment…")).toBeInTheDocument();
    await waitFor(() => expect(calls.reconcile).toBe(1));
    expect(calls.poll).toBe(0);

    await tick(CHECKOUT_POLL_MS);
    await waitFor(() => expect(calls.poll).toBe(1));
    await tick(CHECKOUT_POLL_MS);
    await waitFor(() => expect(calls.poll).toBe(2));
    expect(calls.reconcile).toBe(1);
    expect(screen.getByText("Checking your payment…")).toBeInTheDocument();
  });

  it("shows the order code once paid, clears the basket, reports the sale and stops polling", async () => {
    const calls = listen({ reconcile: () => json(pending()), poll: (n) => json(n < 2 ? pending() : paidOrder()) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    await waitFor(() => expect(calls.reconcile).toBe(1));
    expect(storedCart()).toHaveLength(1);

    await tick(CHECKOUT_POLL_MS);
    await tick(CHECKOUT_POLL_MS);
    expect(await screen.findByText("Payment received")).toBeInTheDocument();
    expect(screen.getByText("Your order code")).toBeInTheDocument();
    expect(screen.getByText("BO-000001")).toBeInTheDocument();
    expect(screen.getByText("Show this code at the branch when you collect your parts.")).toBeInTheDocument();
    // plan Task 14: no email is sent in phase 1, so no copy claims one
    expect(document.body).not.toHaveTextContent(/e-?mail/i);

    // where to collect: the Bin Omran branch card with its phone and map
    const branch = getBranches("en").binomran;
    expect(screen.getAllByText(branch.name).length).toBeGreaterThan(0);
    expect(document.querySelector(`a[href="tel:${branch.tel}"]`)).toBeInTheDocument();
    expect(document.querySelector(`a[href="${branch.maps}"]`)).toBeInTheDocument();

    await waitFor(() => expect(storedCart()).toEqual([]));
    expect(tracked()).toContain("order_paid");
    expect(tracked().filter((t) => t === "order_paid")).toHaveLength(1);

    const polls = calls.poll;
    await tick(CHECKOUT_POLL_MS * 3);
    expect(calls.poll).toBe(polls);
  });

  it("needs no poll when reconcile already finds the order paid", async () => {
    const calls = listen({ reconcile: () => json(paidOrder()), poll: () => json(paidOrder()) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    expect(await screen.findByText("BO-000001")).toBeInTheDocument();
    await tick(CHECKOUT_POLL_MS * 2);
    expect(calls.poll).toBe(0);
    expect(calls.reconcile).toBe(1);
  });

  it("says the payment did not go through when the last attempt failed, and offers another card", async () => {
    const calls = listen({ reconcile: () => json(webOrder({ lastPayment: { status: "FAILED", failureCode: "DECLINED" } })) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);

    expect(await screen.findByText("The payment didn't go through.")).toBeInTheDocument();
    // controller ruling C5 (spec: back to the pay step): the same order, never a second one
    expect(screen.getByRole("link", { name: "Try another card" })).toHaveAttribute("href", `/checkout?order=${ORDER_ID}`);
    expect(screen.queryByText("Payment received")).not.toBeInTheDocument();
    expect(screen.queryByText("BO-000001")).not.toBeInTheDocument();

    await tick(CHECKOUT_POLL_MS * 2);
    expect(calls.poll).toBe(0);
    expect(storedCart()).toHaveLength(1);
    expect(tracked()).not.toContain("order_paid");
  });

  it("says an expired order expired", async () => {
    listen({ reconcile: () => json(webOrder({ status: "CANCELLED", lastPayment: null })) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    expect(await screen.findByText("This order has expired. Go back to review your cart and try again.")).toBeInTheDocument();
    expect(screen.queryByText("Payment received")).not.toBeInTheDocument();
  });

  it("says an order the sweep cancelled expired, and stops polling", async () => {
    // plan Task 7: the sweep cancels the order but leaves paymentStatus PENDING and the stale INITIATED attempt
    const swept = webOrder({ status: "CANCELLED", paymentStatus: "PENDING", lastPayment: { status: "INITIATED", failureCode: null } });
    const calls = listen({ reconcile: () => json(pending()), poll: () => json(swept) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    await waitFor(() => expect(calls.reconcile).toBe(1));

    await tick(CHECKOUT_POLL_MS);
    expect(await screen.findByText("This order has expired. Go back to review your cart and try again.")).toBeInTheDocument();
    expect(screen.queryByText("Payment received")).not.toBeInTheDocument();
    expect(tracked()).not.toContain("order_paid");

    const polls = calls.poll;
    expect(polls).toBeGreaterThan(0);
    await tick(CHECKOUT_POLL_MS * 3);
    expect(calls.poll).toBe(polls);
  });

  // plan Task 6: a capture held back (wrong amount, or a second charge) leaves the order unpaid for staff to sort out
  it.each(["AMOUNT_MISMATCH", "DUPLICATE_CAPTURE"] as const)(
    "tells the customer a captured payment held back as %s reached the branch, and stops polling",
    async (failureCode) => {
      const held = webOrder({ status: "PENDING", paymentStatus: "PENDING", lastPayment: { status: "CAPTURED", failureCode } });
      const calls = listen({ reconcile: () => json(pending()), poll: () => json(held) });
      renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
      await waitFor(() => expect(calls.reconcile).toBe(1));

      await tick(CHECKOUT_POLL_MS);
      expect(await screen.findByText("We received your payment. The branch will contact you to finish your order.")).toBeInTheDocument();
      expect(screen.queryByText("Payment received")).not.toBeInTheDocument();
      expect(screen.queryByText("The payment didn't go through.")).not.toBeInTheDocument();
      expect(tracked()).not.toContain("order_paid");
      // controller ruling (c): the money was taken, so the basket is bought, but it is not counted as a sale
      await waitFor(() => expect(storedCart()).toEqual([]));

      const polls = calls.poll;
      expect(polls).toBeGreaterThan(0);
      await tick(CHECKOUT_POLL_MS * 3);
      expect(calls.poll).toBe(polls);
    },
  );

  // controller ruling (d): a capture with a failure code on any order that is not paid is held for the branch
  it.each([
    ["a refunded order", webOrder({ status: "CANCELLED", paymentStatus: "REFUNDED", lastPayment: { status: "CAPTURED", failureCode: "DUPLICATE_CAPTURE" } })],
    ["an expired order", webOrder({ status: "CANCELLED", paymentStatus: "PENDING", lastPayment: { status: "CAPTURED", failureCode: "AMOUNT_MISMATCH" } })],
  ])("says a held capture on %s reached the branch", async (_, order) => {
    listen({ reconcile: () => json(order) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    expect(await screen.findByText("We received your payment. The branch will contact you to finish your order.")).toBeInTheDocument();
    expect(screen.queryByText(/expired|refunded/)).not.toBeInTheDocument();
  });

  // controller ruling (d): not "expired… try again"
  it("says a refunded order was cancelled and refunded, and keeps the basket", async () => {
    const refunded = paidOrder({ status: "CANCELLED", paymentStatus: "REFUNDED", lastPayment: { status: "CAPTURED", failureCode: null } });
    const calls = listen({ reconcile: () => json(refunded) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);

    expect(await screen.findByText("This order was cancelled and your payment was refunded.")).toBeInTheDocument();
    expect(screen.queryByText(/expired/)).not.toBeInTheDocument();
    expect(screen.queryByText("Payment received")).not.toBeInTheDocument();
    await tick(CHECKOUT_POLL_MS * 2);
    expect(calls.poll).toBe(0);
    expect(storedCart()).toHaveLength(1);
    expect(tracked()).not.toContain("order_paid");
  });

  it("stops polling after CHECKOUT_POLL_MAX_MS", async () => {
    const calls = listen({ reconcile: () => json(pending()), poll: () => json(pending()) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    await waitFor(() => expect(calls.reconcile).toBe(1));

    for (let elapsed = 0; elapsed < CHECKOUT_POLL_MAX_MS * 2; elapsed += CHECKOUT_POLL_MS) await tick(CHECKOUT_POLL_MS);
    const polls = calls.poll;
    expect(polls).toBeGreaterThan(0);
    expect(polls).toBeLessThanOrEqual(CHECKOUT_POLL_MAX_MS / CHECKOUT_POLL_MS);
    await tick(CHECKOUT_POLL_MS * 3);
    expect(calls.poll).toBe(polls);
  });

  it("says it is still waiting once polling gives up, and checks again on request", async () => {
    const calls = listen({ reconcile: (n) => json(n < 2 ? pending() : paidOrder()), poll: () => json(pending()) });
    const { user } = renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    await waitFor(() => expect(calls.reconcile).toBe(1));

    for (let elapsed = 0; elapsed <= CHECKOUT_POLL_MAX_MS; elapsed += CHECKOUT_POLL_MS) await tick(CHECKOUT_POLL_MS);
    expect(await screen.findByText("We're still waiting for the bank to confirm your payment. Check again in a minute.")).toBeInTheDocument();
    // no answer is not a refusal: nothing invites a second payment
    expect(screen.queryByRole("link", { name: "Try another card" })).not.toBeInTheDocument();
    expect(storedCart()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Payment received")).toBeInTheDocument();
    expect(calls.reconcile).toBe(2);
    await waitFor(() => expect(storedCart()).toEqual([]));
  });

  it("does not empty a new basket nor count the sale again when the paid page is shown again in the tab", async () => {
    listen({ reconcile: () => json(paidOrder()) });
    const first = renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    expect(await screen.findByText("BO-000001")).toBeInTheDocument();
    await waitFor(() => expect(storedCart()).toEqual([]));
    first.unmount();

    // a new basket, then Back (or a reload) to the same return page
    act(() => cart.add(CART_PRODUCTS[1]));
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    expect(await screen.findByText("BO-000001")).toBeInTheDocument();
    expect(storedCart()).toHaveLength(1);
    expect(tracked().filter((t) => t === "order_paid")).toHaveLength(1);
  });

  // controller ruling (a): with the order, so the checkout picks it up again after the code
  it("sends a customer whose session is gone back to the checkout, with the order", async () => {
    listen({ reconcile: () => apiError(401, "SESSION_EXPIRED") });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout?order=${ORDER_ID}`));
  });

  it("says a refunded order was refunded in Arabic", async () => {
    listen({ reconcile: () => json(paidOrder({ status: "CANCELLED", paymentStatus: "REFUNDED" })) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />, { locale: "ar" });
    expect(await screen.findByText("تم إلغاء هذا الطلب واسترداد المبلغ الذي دفعته.")).toBeInTheDocument();
  });

  it("is written in Arabic on the Arabic site", async () => {
    listen({ reconcile: () => json(paidOrder()) });
    renderOnSite(<ReturnStatus orderId={ORDER_ID} />, { locale: "ar" });
    expect(await screen.findByText("تم استلام الدفع")).toBeInTheDocument();
    // the root بريد also catches بريدك and بريدًا
    expect(document.body).not.toHaveTextContent(/بريد|إيميل/);
    expect(screen.getAllByText(getBranches("ar").binomran.name).length).toBeGreaterThan(0);
  });
});
