import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import type { WebOrder } from "@/lib/api/types";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError, customer, ORDER_ID, paidOrder, setCustomerHint, webOrder } from "@/tests/shop-fixtures";
import { OrderView } from "./order-view";

afterEach(() => setCustomerHint(false));

function signedInWith(order: WebOrder | Response) {
  setCustomerHint(true);
  server.use(
    http.get("/api/shop/me", () => HttpResponse.json(customer())),
    http.get(`/api/shop/orders/${ORDER_ID}`, () => (order instanceof Response ? order : HttpResponse.json(order))),
  );
}

describe("one of my orders", () => {
  it("shows the code, state, parts and total of a paid order, and where to collect it", async () => {
    signedInWith(paidOrder());
    renderOnSite(<OrderView orderId={ORDER_ID} />);
    expect(await screen.findByRole("heading", { name: "Order BO-000001" })).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText(/Show your order code at Bin Omran/)).toBeInTheDocument();
    expect(screen.getByText("4K Dash Cam (Front & Rear)")).toBeInTheDocument();
    expect(screen.getByText(/619\.50/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue payment" })).not.toBeInTheDocument();
  });

  it("offers to continue the payment of an open unpaid order", async () => {
    signedInWith(webOrder({ expiresAt: "2999-01-01T00:00:00.000Z" }));
    renderOnSite(<OrderView orderId={ORDER_ID} />);
    expect(await screen.findByRole("link", { name: "Continue payment" })).toHaveAttribute("href", `/checkout?order=${ORDER_ID}`);
  });

  it("says when the order is not in this account", async () => {
    signedInWith(apiError(404, "ORDER_NOT_FOUND"));
    renderOnSite(<OrderView orderId={ORDER_ID} />);
    expect(await screen.findByText("We couldn't find this order in your account.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to my orders" })).toHaveAttribute("href", "/account");
  });

  it("asks to sign in first when nobody is signed in", async () => {
    renderOnSite(<OrderView orderId={ORDER_ID} />);
    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
  });
});
