import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser, renderWithApp } from "@/tests/render";
import { Can } from "./auth-provider";
import { homePath, safeNext, visibleNav } from "./navigation";

describe("role landing pages", () => {
  it("sends each role to its own dashboard", () => {
    expect(homePath("SUPER_ADMIN")).toBe("/dashboard");
    expect(homePath("FINANCE")).toBe("/dashboard/products");
    expect(homePath("BRANCH_MANAGER")).toBe("/dashboard/products");
    expect(homePath("CASHIER")).toBe("/dashboard/orders");
    expect(homePath("RESERVATIONS")).toBe("/dashboard/ppf-bookings");
  });

  it("accepts only same-app dashboard paths after login (no open redirect)", () => {
    expect(safeNext("/ar/dashboard/orders", "ar")).toBe("/dashboard/orders");
    expect(safeNext("https://evil.example/ar/dashboard", "ar")).toBeNull();
    expect(safeNext("//evil.example", "ar")).toBeNull();
    expect(safeNext("/ar/dashboard//evil", "ar")).toBeNull();
    expect(safeNext("/en/dashboard", "ar")).toBeNull();
  });
});

describe("permission-gated navigation", () => {
  const labels = (perms: Parameters<typeof visibleNav>[0]) => visibleNav(perms).map((i) => i.label);

  it("shows a cashier only overview, orders and account", () => {
    expect(labels(["order.read.branch", "order.confirm", "order.create"])).toEqual(["overview", "orders", "account"]);
  });

  it("shows finance products, the services they price, and orders", () => {
    expect(labels(["product.read", "product.update.price", "order.read.all"])).toEqual(["overview", "products", "services", "orders", "account"]);
  });

  it("shows the call center the two booking pages", () => {
    expect(labels(["booking.ppf.read", "booking.ppf.manage", "booking.general.manage"])).toEqual(["overview", "ppfBookings", "reservations", "account"]);
    expect(labels(["booking.ppf.read"])).toEqual(["overview", "ppfBookings", "account"]);
  });

  it("shows the call center the website's orders too (order.web.handle)", () => {
    expect(labels(["booking.ppf.read", "booking.ppf.manage", "booking.general.manage", "order.web.handle"])).toContain("orders");
  });

  it("follows per-user grants (e.g. activity.read given to Finance)", () => {
    expect(labels(["product.read", "activity.read"])).toContain("activity");
  });
});

describe("<Can>", () => {
  it("renders children only with the permission", () => {
    renderWithApp(
      <>
        <Can permission="product.update.price">
          <button>Set price</button>
        </Can>
        <Can permission="product.create" fallback={<span>no create</span>}>
          <button>Add product</button>
        </Can>
      </>,
      { user: makeUser({ permissions: ["product.update.price"] }) },
    );
    expect(screen.getByRole("button", { name: "Set price" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add product" })).not.toBeInTheDocument();
    expect(screen.getByText("no create")).toBeInTheDocument();
  });
});
