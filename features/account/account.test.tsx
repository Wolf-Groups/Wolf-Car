import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError, branchOrder, customer, paidOrder, setCustomerHint, webOrder } from "@/tests/shop-fixtures";
import { Account } from "./account";

afterEach(() => setCustomerHint(false));

function signedIn(orders: unknown[] | Response = []) {
  setCustomerHint(true);
  server.use(
    http.get("/api/shop/me", () => HttpResponse.json(customer())),
    http.get("/api/shop/orders", () => (orders instanceof Response ? orders : HttpResponse.json(orders))),
  );
}

describe("my account", () => {
  it("asks for the email when nobody is signed in", async () => {
    renderOnSite(<Account />);
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("Sign in with your email to see your orders and your cars. We'll email you a code.")).toBeInTheDocument();
  });

  it("lists the customer's orders with their code, state and a link to each", async () => {
    signedIn([paidOrder({ id: "00000000-0000-4000-8000-0000000000b2", code: "BO-000002" }), webOrder({ expiresAt: "2999-01-01T00:00:00.000Z" })]);
    renderOnSite(<Account />);
    expect(await screen.findByText("BO-000002")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toHaveTextContent("sara@example.com");
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Waiting for payment")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /BO-000002/ })).toHaveAttribute("href", "/account/orders/00000000-0000-4000-8000-0000000000b2");
    expect(screen.getAllByText(/· 2 items$/)).toHaveLength(2);
  });

  it("shows an order placed to pay at the branch, waiting for the call and then confirmed", async () => {
    signedIn([
      branchOrder({ id: "00000000-0000-4000-8000-0000000000b3", code: "BO-000003" }),
      branchOrder({ id: "00000000-0000-4000-8000-0000000000b4", code: "BO-000004", status: "CONFIRMED" }),
    ]);
    renderOnSite(<Account />);
    expect(await screen.findByText("Waiting for confirmation")).toBeInTheDocument();
    expect(screen.getByText("Confirmed · pay at the branch")).toBeInTheDocument();
  });

  it("says so when there are no orders yet", async () => {
    signedIn([]);
    renderOnSite(<Account />);
    expect(await screen.findByText("You have no orders yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse products" })).toHaveAttribute("href", "/products");
  });

  it("offers to try again when the orders cannot be loaded", async () => {
    signedIn(apiError(500, "INTERNAL"));
    const { user } = renderOnSite(<Account />);
    expect(await screen.findByText("We couldn't load your orders. Please try again.")).toBeInTheDocument();
    server.use(http.get("/api/shop/orders", () => HttpResponse.json([paidOrder()])));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("BO-000001")).toBeInTheDocument();
  });

  it("signs out back to the sign-in form", async () => {
    signedIn([]);
    let loggedOut = false;
    server.use(
      http.post("/api/shop/logout", () => {
        loggedOut = true;
        setCustomerHint(false);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderOnSite(<Account />);
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(loggedOut).toBe(true);
  });

  it("shows the orders right after the code is verified", async () => {
    server.use(
      http.post("/api/shop/otp", () => HttpResponse.json({ expiresAt: "2999-01-01T00:00:00.000Z" })),
      http.post("/api/shop/otp/verify", () => {
        setCustomerHint(true);
        return HttpResponse.json({ customer: customer(), expiresAt: "2999-01-01T00:00:00.000Z" });
      }),
      http.get("/api/shop/me", () => HttpResponse.json(customer())),
      http.get("/api/shop/orders", () => HttpResponse.json([paidOrder()])),
    );
    const { user } = renderOnSite(<Account />);
    await user.type(await screen.findByLabelText("Email"), "sara@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Verification code"), "123456");
    await waitFor(() => expect(screen.getByText("BO-000001")).toBeInTheDocument());
  });
});
