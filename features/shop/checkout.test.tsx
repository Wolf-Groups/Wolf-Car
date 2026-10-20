import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cart } from "@/features/catalog/cart";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError, CART_PRODUCTS, customer, ORDER_ID, paidOrder, removeCardSdk, setCustomerHint, stubCardSdk, webOrder } from "@/tests/shop-fixtures";
import { Checkout } from "./checkout";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

const fillCart = () =>
  act(() => {
    cart.add(CART_PRODUCTS[0]);
    cart.add(CART_PRODUCTS[1]);
  });

/** "Try another card" on the return page links to /checkout?order=<id> */
const visitWithOrder = (id: string) => window.history.replaceState(null, "", `/en/checkout?order=${id}`);

beforeEach(() => act(() => cart.clear()));
afterEach(() => {
  act(() => cart.clear());
  setCustomerHint(false);
  removeCardSdk();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/en/dashboard");
});

describe("checkout page", () => {
  it("has nothing to pay for with an empty basket and leads back to the products", async () => {
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByText("Your cart is empty. Add some parts first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to products" })).toHaveAttribute("href", "/products");
    expect(screen.queryByLabelText("Mobile number")).not.toBeInTheDocument();
  });

  it("starts at the phone number without asking the API when the browser has no customer hint", async () => {
    fillCart();
    const me = vi.fn();
    server.use(http.get("/api/shop/me", () => (me(), HttpResponse.json(customer()))));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
    expect(me).not.toHaveBeenCalled();
  });

  it("goes straight to the details for a remembered customer", async () => {
    fillCart();
    setCustomerHint(true);
    server.use(http.get("/api/shop/me", () => HttpResponse.json(customer())));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    expect(await screen.findByLabelText("Full name")).toHaveValue("Sara Ali");
    expect(screen.getByLabelText("Email")).toHaveValue("sara@example.com");
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mobile number")).not.toBeInTheDocument();
  });

  it("falls back to the phone number when the remembered session has expired", async () => {
    fillCart();
    setCustomerHint(true);
    server.use(http.get("/api/shop/me", () => apiError(401, "SESSION_EXPIRED")));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });

  it("signs out back to the phone number", async () => {
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
    await screen.findByLabelText("Full name");
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("walks phone → code → details → pay", async () => {
    fillCart();
    stubCardSdk();
    const order = webOrder();
    server.use(
      http.post("/api/shop/otp", () => HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z", devCode: "482915" })),
      http.post("/api/shop/otp/verify", () => HttpResponse.json({ customer: customer({ name: null, email: null }), expiresAt: "2031-04-09T09:00:00.000Z" })),
      http.post("/api/shop/orders", () => HttpResponse.json({ ...order, replayed: false }, { status: 201 })),
    );
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    await user.type(await screen.findByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    // code step; outside production the page shows the code the API echoed
    expect(await screen.findByText(/We sent a 6-digit code to/)).toBeInTheDocument();
    expect(screen.getByText("Development code: 482915")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Verification code"), "482915");

    // details step, empty for a new customer
    const name = await screen.findByLabelText("Full name");
    expect(name).toHaveValue("");
    await user.type(name, "Sara Ali");
    await user.type(screen.getByLabelText("Email"), "sara@example.com");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    // pay step with the server's total
    expect(await screen.findByRole("button", { name: "Pay now" })).toBeInTheDocument();
    expect(screen.getAllByText(/QAR\s619\.50/).length).toBeGreaterThan(0);
  });

  it("never shows the development code on a production build", async () => {
    fillCart();
    server.use(http.post("/api/shop/otp", () => HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z", devCode: "482915" })));
    vi.stubEnv("NODE_ENV", "production");
    // a flag read at module scope has to see production too
    vi.resetModules();
    const { Checkout: ProductionCheckout } = await import("./checkout");
    const { user } = renderOnSite(<ProductionCheckout publicKey="pk_test_wolfcar" />);

    await user.type(await screen.findByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByText(/We sent a 6-digit code to/)).toBeInTheDocument();
    expect(screen.queryByText(/Development code/)).not.toBeInTheDocument();
  });

  it("lets the customer change the number on the code step", async () => {
    fillCart();
    server.use(http.post("/api/shop/otp", () => HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z" })));
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    await user.type(await screen.findByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Verification code");

    await user.click(screen.getByText("Change number"));
    await waitFor(() => expect(screen.getByLabelText("Mobile number")).toBeInTheDocument());
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });

  it("takes focus to the new step when the pressed button goes away", async () => {
    fillCart();
    server.use(http.post("/api/shop/otp", () => HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z" })));
    const { user } = renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);
    await user.type(await screen.findByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => expect(screen.getByRole("group", { name: "Code" })).toHaveFocus());
    await user.click(screen.getByText("Change number"));
    await waitFor(() => expect(screen.getByRole("group", { name: "Phone" })).toHaveFocus());
  });

  // controller ruling C5 (spec: "try another card" goes back to the pay step, never a second order)
  it("takes Try another card back to the pay step of the same order", async () => {
    fillCart();
    stubCardSdk();
    setCustomerHint(true);
    visitWithOrder(ORDER_ID);
    const created = vi.fn();
    server.use(
      http.get("/api/shop/me", () => HttpResponse.json(customer())),
      http.get(`/api/shop/orders/${ORDER_ID}`, () => HttpResponse.json(webOrder({ lastPayment: { status: "FAILED", failureCode: "DECLINED" } }))),
      http.post("/api/shop/orders", () => (created(), apiError(500, "server"))),
    );
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    expect(await screen.findByRole("button", { name: "Pay now" })).toBeInTheDocument();
    expect(screen.getAllByText(/QAR\s619\.50/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", webOrder({ status: "CANCELLED" })],
    ["already paid", paidOrder()],
    ["held for the branch", webOrder({ lastPayment: { status: "CAPTURED", failureCode: "AMOUNT_MISMATCH" } })],
  ])("starts at the details when the order to resume is %s", async (_, order) => {
    fillCart();
    setCustomerHint(true);
    visitWithOrder(ORDER_ID);
    server.use(
      http.get("/api/shop/me", () => HttpResponse.json(customer())),
      http.get(`/api/shop/orders/${ORDER_ID}`, () => HttpResponse.json(order)),
    );
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    expect(await screen.findByLabelText("Full name")).toHaveValue("Sara Ali");
    expect(screen.queryByRole("button", { name: "Pay now" })).not.toBeInTheDocument();
  });

  it("asks for no order to resume without a session, and starts at the phone number", async () => {
    fillCart();
    visitWithOrder(ORDER_ID);
    const asked = vi.fn();
    server.use(http.get(`/api/shop/orders/${ORDER_ID}`, () => (asked(), HttpResponse.json(webOrder()))));
    renderOnSite(<Checkout publicKey="pk_test_wolfcar" />);

    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });
});
