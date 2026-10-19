import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail, PermissionKey } from "@/lib/api/types";
import { server } from "@/tests/msw";
import { makeUser, renderWithApp } from "@/tests/render";
import { OrdersPage } from "./orders-page";

const CASHIER: PermissionKey[] = ["order.create", "order.read.branch", "order.update", "order.cancel", "order.confirm", "order.receipt.download"];
const cashier = () => makeUser({ username: "gh.cashier", displayName: "GH Cashier", role: "CASHIER", permissions: CASHIER });
const finance = () => makeUser({ username: "finance", displayName: "Finance", role: "FINANCE", branch: null, permissions: ["product.read", "product.update.price", "order.read.all"] });

const person = { id: "00000000-0000-4000-8000-0000000000c1", username: "gh.cashier", displayName: "GH Cashier" };
const branch = { id: "b-gh", code: "GH", name: "Al Gharrafa Branch", nameAr: "فرع الغرافة" };

describe("orders page permissions", () => {
  it("shows a no-access state (and asks the API nothing) without an order.read permission", async () => {
    const requested = vi.fn();
    server.use(http.get("/api/orders", () => (requested(), HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 }))));
    renderWithApp(<OrdersPage />, { user: makeUser({ role: "FINANCE", branch: null, permissions: ["product.read"] }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("You can't open this page");
    expect(requested).not.toHaveBeenCalled();
  });
});

function makeOrder(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "00000000-0000-4000-8000-000000000042",
    code: "GH-000042",
    number: 42,
    status: "PENDING",
    source: "SHOWROOM",
    paymentStatus: "NONE",
    paidAt: null,
    collectedAt: null,
    customerName: "Sara Ali",
    customerPhone: null,
    customerEmail: null,
    collectedBy: null,
    payment: null,
    odoo: null,
    total: "705.00",
    currency: "QAR",
    itemCount: 2,
    branch,
    createdBy: person,
    confirmedBy: null,
    confirmedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: "2026-09-21T09:00:00.000Z",
    updatedAt: "2026-09-21T09:00:00.000Z",
    items: [
      { id: "line-1", productId: "p-1", productName: "Brake pads", barcode: "BP-1", thumbUrl: "/api/uploads/p1-sm.webp", unitPrice: "280.00", quantity: 2, lineTotal: "560.00" },
      { id: "line-2", productId: "p-2", productName: "Oil filter", barcode: null, thumbUrl: "/api/uploads/p2-sm.webp", unitPrice: "145.00", quantity: 1, lineTotal: "145.00" },
    ],
    ...overrides,
  };
}

const summary = (order: OrderDetail) => Object.fromEntries(Object.entries(order).filter(([key]) => key !== "items"));
const page = (...orders: OrderDetail[]) => ({ items: orders.map(summary), page: 1, pageSize: 20, total: orders.length });

afterEach(() => window.history.replaceState(null, "", "/en/dashboard"));

async function openOrder(user: ReturnType<typeof renderWithApp>["user"], code = "GH-000042") {
  await user.click(await screen.findByRole("button", { name: `Open order ${code}` }));
  return screen.findByRole("dialog", { name: /Order .*GH-000042/ });
}

describe("orders: cashier", () => {
  it("confirms a pending order", async () => {
    const pending = makeOrder();
    let confirmed = 0;
    server.use(
      http.get("/api/orders", () => HttpResponse.json(page(pending))),
      http.get("/api/orders/:id", () => HttpResponse.json(pending)),
      http.post("/api/orders/:id/confirm", () => {
        confirmed += 1;
        return HttpResponse.json({ ...pending, status: "CONFIRMED", confirmedBy: person, confirmedAt: "2026-09-21T09:05:00.000Z" });
      }),
    );
    const success = vi.spyOn(toast, "success");
    const { user } = renderWithApp(<OrdersPage />, { user: cashier() });
    const sheet = await openOrder(user);
    expect(window.location.search).toBe(`?open=${pending.id}`);

    await user.click(within(sheet).getByRole("button", { name: "Confirm order" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Confirm order .*GH-000042.*\?/ });
    await user.click(within(dialog).getByRole("button", { name: "Confirm order" }));

    await waitFor(() => expect(confirmed).toBe(1));
    expect(success).toHaveBeenCalledWith("Order GH-000042 confirmed");
    // now confirmed: receipts are available and it can no longer be confirmed
    await waitFor(() => expect(within(sheet).getByRole("button", { name: /Arabic receipt/ })).toBeEnabled());
    expect(within(sheet).queryByRole("button", { name: "Confirm order" })).not.toBeInTheDocument();
  });

  it("disables receipts for pending orders and says why", async () => {
    const pending = makeOrder();
    server.use(
      http.get("/api/orders", () => HttpResponse.json(page(pending))),
      http.get("/api/orders/:id", () => HttpResponse.json(pending)),
    );
    const { user } = renderWithApp(<OrdersPage />, { user: cashier() });
    const sheet = await openOrder(user);

    const receipt = within(sheet).getByRole("button", { name: /Arabic receipt/ });
    expect(receipt).toBeDisabled();
    expect(receipt).toHaveAccessibleDescription("Receipts are available after confirmation.");
    expect(within(sheet).getByRole("button", { name: /English receipt/ })).toBeDisabled();
  });

  it("edits quantities and sends only the changed lines", async () => {
    const pending = makeOrder();
    let body: unknown = null;
    server.use(
      http.get("/api/orders", () => HttpResponse.json(page(pending))),
      http.get("/api/orders/:id", () => HttpResponse.json(pending)),
      http.patch("/api/orders/:id", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(pending);
      }),
    );
    const { user } = renderWithApp(<OrdersPage />, { user: cashier() });
    const sheet = await openOrder(user);
    await user.click(within(sheet).getByRole("button", { name: "Edit order" }));
    await user.click(within(sheet).getByRole("button", { name: "Increase quantity of Oil filter" }));
    await user.click(within(sheet).getByRole("button", { name: "Remove Brake pads" }));
    expect(within(sheet).getByRole("button", { name: "Remove Oil filter" })).toBeDisabled();
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(body).toEqual({ items: [{ productId: "p-2", quantity: 2 }] }));
  });

  it("reports an order that stopped being pending and reloads it", async () => {
    const pending = makeOrder();
    let reads = 0;
    server.use(
      http.get("/api/orders", () => HttpResponse.json(page(pending))),
      http.get("/api/orders/:id", () => {
        reads += 1;
        return HttpResponse.json(reads === 1 ? pending : { ...pending, status: "CANCELLED" });
      }),
      http.post("/api/orders/:id/confirm", () =>
        HttpResponse.json({ statusCode: 409, error: "Conflict", code: "ORDER_NOT_PENDING", message: "Order is cancelled." }, { status: 409 }),
      ),
    );
    const failure = vi.spyOn(toast, "error");
    const { user } = renderWithApp(<OrdersPage />, { user: cashier() });
    const sheet = await openOrder(user);
    await user.click(within(sheet).getByRole("button", { name: "Confirm order" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm order" }));

    await waitFor(() => expect(failure).toHaveBeenCalledWith("This order is no longer pending, so it can't be changed."));
    await waitFor(() => expect(within(sheet).getByText("Cancelled")).toBeInTheDocument());
    expect(within(sheet).queryByRole("button", { name: "Confirm order" })).not.toBeInTheDocument();
  });
});

describe("orders: finance (read-only, all branches)", () => {
  it("opens ?open=<id> directly and offers no actions", async () => {
    const confirmed = makeOrder({ status: "CONFIRMED", confirmedBy: person, confirmedAt: "2026-09-21T09:05:00.000Z" });
    window.history.replaceState(null, "", `/en/dashboard/orders?open=${confirmed.id}`);
    server.use(
      http.get("/api/orders", () => HttpResponse.json(page(confirmed))),
      http.get("/api/orders/:id", () => HttpResponse.json(confirmed)),
      http.get("/api/branches/options", () => HttpResponse.json([{ ...branch, isActive: true }])),
    );
    renderWithApp(<OrdersPage />, { user: finance() });

    const sheet = await screen.findByRole("dialog", { name: /Order .*GH-000042/ });
    expect(await within(sheet).findByText("Confirmed orders can't be changed.")).toBeInTheDocument();
    for (const name of ["Confirm order", "Edit order", "Cancel order", /receipt/i]) {
      expect(within(sheet).queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("columnheader", { name: "Branch" })).toBeInTheDocument();
    expect(screen.getByText("Orders from every branch (read-only).")).toBeInTheDocument();
  });
});

describe("orders: filters", () => {
  it("sends status, customer name and order number to the API and keeps them in the URL", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get("/api/orders", ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json(page(makeOrder()));
      }),
    );
    const { user } = renderWithApp(<OrdersPage />, { user: cashier() });
    await screen.findByRole("button", { name: "Open order GH-000042" });
    expect(requests.at(-1)?.toString()).toBe("page=1&pageSize=20");

    await user.click(screen.getByRole("button", { name: "Pending" }));
    await waitFor(() => expect(requests.at(-1)?.get("status")).toBe("PENDING"));
    expect(screen.getByRole("button", { name: "Pending" })).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByLabelText("Customer name"), "Sara");
    await waitFor(() => expect(requests.at(-1)?.get("customerName")).toBe("Sara"));

    await user.type(screen.getByLabelText("Order number"), "42");
    await waitFor(() => expect(requests.at(-1)?.get("orderNumber")).toBe("42"));
    expect(requests.at(-1)?.get("status")).toBe("PENDING");
    expect(window.location.search).toBe("?status=PENDING&customerName=Sara&orderNumber=42");

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(requests.at(-1)?.toString()).toBe("page=1&pageSize=20"));
    expect(screen.getByLabelText("Customer name")).toHaveValue("");
    expect(window.location.search).toBe("");
  });
});

describe("orders: web orders", () => {
  const boBranch = { id: "b-bo", code: "BO", name: "Bin Omran Branch", nameAr: "فرع بن عمران" };
  const systemWeb = { id: "00000000-0000-4000-8000-0000000000d1", username: "system.web", displayName: "Website orders" };
  const web = (code: string, overrides: Partial<OrderDetail> = {}) =>
    makeOrder({
      id: `00000000-0000-4000-8000-${code.replace(/\D/g, "").padStart(12, "0")}`,
      code,
      source: "WEB",
      customerPhone: "+97455123456",
      customerEmail: "sara@example.com",
      branch: boBranch,
      createdBy: systemWeb,
      ...overrides,
    });
  const row = (code: string) => screen.getByRole("button", { name: `Open order ${code}` }).closest("tr")!;

  it("marks web orders with a Web pill and their payment next to the status", async () => {
    const showroom = makeOrder();
    const paid = web("BO-000007", { status: "CONFIRMED", paymentStatus: "PAID", paidAt: "2026-09-21T09:05:00.000Z", confirmedBy: systemWeb, confirmedAt: "2026-09-21T09:05:00.000Z" });
    const unpaid = web("BO-000008", { paymentStatus: "PENDING" });
    const collected = web("BO-000009", {
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paidAt: "2026-09-21T09:05:00.000Z",
      collectedAt: "2026-09-21T12:00:00.000Z",
      confirmedBy: systemWeb,
      confirmedAt: "2026-09-21T09:05:00.000Z",
    });
    const refunded = web("BO-000010", { status: "CANCELLED", paymentStatus: "REFUNDED", paidAt: "2026-09-21T09:05:00.000Z" });
    server.use(http.get("/api/orders", () => HttpResponse.json(page(showroom, paid, unpaid, collected, refunded))));
    renderWithApp(<OrdersPage />, { user: cashier() });
    await screen.findByRole("button", { name: "Open order BO-000007" });

    expect(within(row("BO-000007")).getByText("Web")).toBeInTheDocument();
    expect(within(row("BO-000007")).getByText("Paid")).toBeInTheDocument();
    expect(within(row("BO-000008")).getByText("Web")).toBeInTheDocument();
    expect(within(row("BO-000008")).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(row("BO-000009")).getByText("Collected")).toBeInTheDocument();
    // one or the other: a collected order no longer says Paid
    expect(within(row("BO-000009")).queryByText("Paid")).not.toBeInTheDocument();
    expect(within(row("BO-000010")).getByText("Web")).toBeInTheDocument();
    expect(within(row("BO-000010")).getByText("Refunded")).toBeInTheDocument();
    // a showroom order is paid at the till: no pill, no payment badge
    expect(within(row("GH-000042")).queryByText("Web")).not.toBeInTheDocument();
    expect(within(row("GH-000042")).queryByText(/Paid|Awaiting payment|Refunded|Collected/)).not.toBeInTheDocument();
  });

  it("filters by source and keeps it in the URL", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get("/api/orders", ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json(page(makeOrder()));
      }),
    );
    const { user } = renderWithApp(<OrdersPage />, { user: cashier() });
    await screen.findByRole("button", { name: "Open order GH-000042" });
    expect(requests.at(-1)?.has("source")).toBe(false);

    const source = screen.getByRole("group", { name: "Source" });
    expect(within(source).getByRole("button", { name: "All sources" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(source).getByRole("button", { name: "Web" }));
    await waitFor(() => expect(requests.at(-1)?.get("source")).toBe("WEB"));
    expect(within(source).getByRole("button", { name: "Web" })).toHaveAttribute("aria-pressed", "true");
    expect(window.location.search).toBe("?source=WEB");

    await user.click(within(source).getByRole("button", { name: "Showroom" }));
    await waitFor(() => expect(requests.at(-1)?.get("source")).toBe("SHOWROOM"));

    await user.click(within(source).getByRole("button", { name: "All sources" }));
    await waitFor(() => expect(requests.at(-1)?.has("source")).toBe(false));
    expect(window.location.search).toBe("");
  });

  it("opens ?source=WEB already filtered", async () => {
    window.history.replaceState(null, "", "/en/dashboard/orders?source=WEB");
    const requests: URLSearchParams[] = [];
    server.use(
      http.get("/api/orders", ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json(page(web("BO-000007", { paymentStatus: "PENDING" })));
      }),
    );
    renderWithApp(<OrdersPage />, { user: cashier() });
    await screen.findByRole("button", { name: "Open order BO-000007" });
    expect(requests[0].get("source")).toBe("WEB");
    expect(within(screen.getByRole("group", { name: "Source" })).getByRole("button", { name: "Web" })).toHaveAttribute("aria-pressed", "true");
  });
});
