import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError, customer, paidOrder, setCustomerHint, webOrder } from "@/tests/shop-fixtures";
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
  it("asks for the mobile number when nobody is signed in", async () => {
    renderOnSite(<Account />);
    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
    expect(screen.getByText("Sign in with your mobile number to see your orders.")).toBeInTheDocument();
  });

  it("lists the customer's orders with their code, state and a link to each", async () => {
    signedIn([paidOrder({ id: "00000000-0000-4000-8000-0000000000b2", code: "BO-000002" }), webOrder({ expiresAt: "2999-01-01T00:00:00.000Z" })]);
    renderOnSite(<Account />);
    expect(await screen.findByText("BO-000002")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toHaveTextContent("5512 3456");
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Waiting for payment")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /BO-000002/ })).toHaveAttribute("href", "/account/orders/00000000-0000-4000-8000-0000000000b2");
    expect(screen.getAllByText(/· 2 items$/)).toHaveLength(2);
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
    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
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
    await user.type(await screen.findByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Verification code"), "123456");
    await waitFor(() => expect(screen.getByText("BO-000001")).toBeInTheDocument());
  });
});
