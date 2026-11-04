import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cart } from "@/features/catalog/cart";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { router } from "@/tests/setup";
import {
  apiError,
  branchOrder,
  CART_PRODUCTS,
  customer,
  ORDER_ID,
  ORDER_KEY,
  paidOrder,
  removeCardSdk,
  setCustomerHint,
  stubCardSdk,
  webOrder,
} from "@/tests/shop-fixtures";
import { Checkout } from "./checkout";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

const fillCart = () =>
  act(() => {
    cart.add(CART_PRODUCTS[0]);
    cart.add(CART_PRODUCTS[1]);
  });

/** the Pay button says the amount */
const PAY = /^Pay QAR\s619\.50$/;

/** "Try another card" on the return page links to /checkout?order=<id>&key=<key> */
const visitWithOrder = (id: string, key: string | null = ORDER_KEY) =>
  window.history.replaceState(null, "", `/en/checkout?order=${id}${key ? `&key=${key}` : ""}`);

/** A guest types their details. */
async function typeDetails(user: ReturnType<typeof renderOnSite>["user"]) {
  await user.type(await screen.findByLabelText("Full name"), "Sara Ali");
  await user.type(screen.getByLabelText("Mobile number"), "55123456");
  await user.type(screen.getByLabelText("Email"), "sara@example.com");
}

beforeEach(() => act(() => cart.clear()));
afterEach(() => {
  act(() => cart.clear());
  setCustomerHint(false);
  removeCardSdk();
  window.history.replaceState(null, "", "/en/dashboard");
});

describe("checkout page", () => {
  it("has nothing to order with an empty basket and leads back to the products", async () => {
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByText("Your cart is empty. Add some parts first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to products" })).toHaveAttribute("href", "/products");
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });

  it("has nothing to order online when no line has a price, and offers WhatsApp for them", async () => {
    act(() => cart.add({ id: "p-wrap", name: "PPF Full Wrap", price: null, thumbUrl: "/api/uploads/wrap-sm.webp" }));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByText("Nothing in your cart has a price yet, so it can't be ordered online. Order it on WhatsApp instead.")).toBeInTheDocument();
    expect(decodeURIComponent(screen.getByRole("link", { name: "Order on WhatsApp · Bin Omran" }).getAttribute("href") ?? "")).toContain("PPF Full Wrap");
  });

  it("starts at the details for a guest, without asking the API, and offers to sign in", async () => {
    fillCart();
    const me = vi.fn();
    server.use(http.get("/api/shop/me", () => (me(), HttpResponse.json(customer()))));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByLabelText("Full name")).toHaveValue("");
    expect(screen.getByLabelText("Mobile number")).toHaveValue("");
    expect(screen.getByText("Have an account?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(me).not.toHaveBeenCalled();
  });

  it("without card payment, still takes the order, to pay at the branch", async () => {
    fillCart();
    renderOnSite(<Checkout publicKey="" />);
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place order" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    // one step only: no step bar
    expect(screen.queryByText("Payment")).not.toBeInTheDocument();
  });

  it("fills the details in for a remembered customer, with the account's email", async () => {
    fillCart();
    setCustomerHint(true);
    server.use(http.get("/api/shop/me", () => HttpResponse.json(customer())));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    expect(await screen.findByLabelText("Full name")).toHaveValue("Sara Ali");
    expect(screen.getByLabelText("Mobile number")).toHaveValue("55123456");
    expect(screen.getByLabelText("Email")).toHaveValue("sara@example.com");
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.getByText(/Signed in as .*sara@example\.com/)).toBeInTheDocument();
  });

  it("treats an expired session as a guest", async () => {
    fillCart();
    setCustomerHint(true);
    server.use(http.get("/api/shop/me", () => apiError(401, "SESSION_EXPIRED")));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByLabelText("Full name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("signs out to an empty form", async () => {
    fillCart();
    setCustomerHint(true);
    const logout = vi.fn();
    server.use(
      http.get("/api/shop/me", () => HttpResponse.json(customer())),
      http.post("/api/shop/logout", () => {
        logout();
        setCustomerHint(false);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByLabelText("Full name")).toHaveValue("Sara Ali");
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByLabelText("Full name")).toHaveValue(""));
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("readonly");
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("signs in on the page with the emailed code, which fills the details", async () => {
    fillCart();
    server.use(
      http.post("/api/shop/otp", () => HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z", devCode: "482915" })),
      http.post("/api/shop/otp/verify", () => {
        setCustomerHint(true);
        return HttpResponse.json({ customer: customer(), expiresAt: "2031-04-09T09:00:00.000Z" });
      }),
      http.get("/api/shop/me", () => HttpResponse.json(customer())),
    );
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Email"), "sara@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("Development code: 482915")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Verification code"), "482915");

    expect(await screen.findByLabelText("Full name")).toHaveValue("Sara Ali");
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
  });

  it("goes back to ordering as a guest from the sign-in", async () => {
    fillCart();
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue without an account" }));
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
  });

  it("a guest walks details → pay, and the order and its key go in the address", async () => {
    fillCart();
    const { sdk } = stubCardSdk();
    const order = webOrder();
    const fetched = vi.fn();
    server.use(
      http.get(`/api/shop/orders/${ORDER_ID}`, () => (fetched(), HttpResponse.json(order))),
      http.post("/api/shop/orders", () => HttpResponse.json({ ...order, replayed: false, key: ORDER_KEY }, { status: 201 })),
    );
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    await typeDetails(user);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    // pay step with the server's total
    expect(await screen.findByRole("button", { name: PAY })).toBeInTheDocument();
    expect(screen.getAllByText(/QAR\s619\.50/).length).toBeGreaterThan(0);
    // the order is in the address, so a reload or Back from the bank's page reopens this step...
    expect(window.location.search).toBe(`?order=${ORDER_ID}&key=${ORDER_KEY}`);
    // ...without fetching it again or drawing Tap's form twice now
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalledTimes(1));
    expect(fetched).not.toHaveBeenCalled();
    // focus follows to the new step
    await waitFor(() => expect(screen.getByRole("group", { name: "Payment" })).toHaveFocus());
  });

  it("a guest who pays at the branch goes straight to the thank-you page of that order", async () => {
    fillCart();
    server.use(http.post("/api/shop/orders", () => HttpResponse.json({ ...branchOrder(), replayed: false, key: ORDER_KEY }, { status: 201 })));
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    await typeDetails(user);
    await user.click(screen.getByRole("radio", { name: /Pay at the branch when you collect/ }));
    await user.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/return?order=${ORDER_ID}&key=${ORDER_KEY}`));
  });

  it("takes the order out of the address when it expired, and keeps the guest's details for the new one", async () => {
    fillCart();
    stubCardSdk();
    server.use(
      http.post("/api/shop/orders", () => HttpResponse.json({ ...webOrder(), replayed: false, key: ORDER_KEY }, { status: 201 })),
      http.post(`/api/shop/orders/${ORDER_ID}/pay`, () => apiError(409, "ORDER_NOT_PAYABLE")),
    );
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    await typeDetails(user);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    await user.click(await screen.findByRole("button", { name: "Back to your details" }));
    expect(await screen.findByLabelText("Full name")).toHaveValue("Sara Ali");
    expect(screen.getByLabelText("Mobile number")).toHaveValue("55123456");
    expect(screen.getByLabelText("Email")).toHaveValue("sara@example.com");
    expect(window.location.search).toBe("");
  });

  // controller ruling C5 (spec: "try another card" goes back to the pay step, never a second order)
  it("takes a guest's Try another card back to the pay step of the same order, opened with its key", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    fillCart();
    stubCardSdk();
    visitWithOrder(ORDER_ID);
    const created = vi.fn();
    const keys: (string | null)[] = [];
    server.use(
      http.get(`/api/shop/orders/${ORDER_ID}`, ({ request }) => {
        keys.push(request.headers.get("x-order-key"));
        return HttpResponse.json(webOrder({ lastPayment: { status: "FAILED", failureCode: "DECLINED" } }));
      }),
      http.post("/api/shop/orders", () => (created(), apiError(500, "server"))),
    );
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    expect(await screen.findByRole("button", { name: PAY })).toBeInTheDocument();
    expect(keys).toEqual([ORDER_KEY]);
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
    // opened by itself: the card, not the order list, is brought into view
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
  });

  it("asks Tap about a charge still open at the bank before offering Pay again, and shows a paid order its result", async () => {
    fillCart();
    stubCardSdk();
    visitWithOrder(ORDER_ID);
    const reconciled = vi.fn();
    server.use(
      http.get(`/api/shop/orders/${ORDER_ID}`, () => HttpResponse.json(webOrder({ lastPayment: { status: "INITIATED", failureCode: null } }))),
      http.post(`/api/shop/orders/${ORDER_ID}/reconcile`, () => (reconciled(), HttpResponse.json(paidOrder()))),
    );
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/checkout/return?order=${ORDER_ID}&key=${ORDER_KEY}`));
    expect(reconciled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: PAY })).not.toBeInTheDocument();
  });

  it("offers Pay again on our own record when Tap cannot be asked", async () => {
    fillCart();
    stubCardSdk();
    visitWithOrder(ORDER_ID);
    server.use(
      http.get(`/api/shop/orders/${ORDER_ID}`, () => HttpResponse.json(webOrder({ lastPayment: { status: "INITIATED", failureCode: null } }))),
      http.post(`/api/shop/orders/${ORDER_ID}/reconcile`, () => apiError(503, "CHECKOUT_UNAVAILABLE")),
    );
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByRole("button", { name: PAY })).toBeInTheDocument();
  });

  it.each([
    ["does not open with this key", 404, ""],
    ["cannot be read right now", 503, `?order=${ORDER_ID}&key=${ORDER_KEY}`],
  ])("starts at the details when the order to resume %s, keeping it in the address only for a retry", async (_, status, search) => {
    fillCart();
    visitWithOrder(ORDER_ID);
    server.use(http.get(`/api/shop/orders/${ORDER_ID}`, () => apiError(status, status === 404 ? "NOT_FOUND" : "server")));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    expect(window.location.search).toBe(search);
  });

  it("starts at the details when the order to resume has expired", async () => {
    fillCart();
    visitWithOrder(ORDER_ID);
    server.use(http.get(`/api/shop/orders/${ORDER_ID}`, () => HttpResponse.json(webOrder({ status: "CANCELLED" }))));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PAY })).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    // a reload now starts a new order instead of finding the expired one again
    expect(window.location.search).toBe("");
  });

  // controller ruling (b): nothing is left to pay, so no new checkout starts for it
  it.each([
    ["paid", paidOrder()],
    ["held as AMOUNT_MISMATCH", webOrder({ lastPayment: { status: "CAPTURED", failureCode: "AMOUNT_MISMATCH" } })],
    ["held as DUPLICATE_CAPTURE", webOrder({ status: "CANCELLED", paymentStatus: "REFUNDED", lastPayment: { status: "CAPTURED", failureCode: "DUPLICATE_CAPTURE" } })],
    ["to pay at the branch", branchOrder()],
  ])("sends an order to resume that is %s to its return page", async (_, order) => {
    fillCart();
    visitWithOrder(ORDER_ID);
    server.use(http.get(`/api/shop/orders/${ORDER_ID}`, () => HttpResponse.json(order)));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/checkout/return?order=${ORDER_ID}&key=${ORDER_KEY}`));
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });

  it("resumes a signed-in customer's own order by the cookie when the address has no key", async () => {
    fillCart();
    stubCardSdk();
    setCustomerHint(true);
    visitWithOrder(ORDER_ID, null);
    server.use(
      http.get("/api/shop/me", () => HttpResponse.json(customer())),
      http.get(`/api/shop/orders/${ORDER_ID}`, () => HttpResponse.json(webOrder({ lastPayment: { status: "FAILED", failureCode: "DECLINED" } }))),
    );
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByRole("button", { name: PAY })).toBeInTheDocument();
  });

  it("asks for no order without a key or a session, and starts at the details", async () => {
    fillCart();
    visitWithOrder(ORDER_ID, null);
    const asked = vi.fn();
    server.use(http.get(`/api/shop/orders/${ORDER_ID}`, () => (asked(), HttpResponse.json(webOrder()))));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });
});
