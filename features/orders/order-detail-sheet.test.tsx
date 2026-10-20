import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import type { OrderDetail, PermissionKey } from "@/lib/api/types";
import { server } from "@/tests/msw";
import { makeUser, renderWithApp } from "@/tests/render";
import { OrderDetailSheet } from "./order-detail-sheet";

const BRANCH = { id: "b-bo", code: "BO", name: "Bin Omran Branch", nameAr: "فرع بن عمران" };
/** Granted to Finance by plan Task 1 (shared/permissions.ts); spelled out here until that key exists. */
const ODOO_RETRY = "order.odoo.retry" as string as PermissionKey;
const CASHIER: PermissionKey[] = ["order.create", "order.read.branch", "order.update", "order.cancel", "order.confirm", "order.receipt.download"];
const boCashier = () => makeUser({ username: "bo.cashier", displayName: "BO Cashier", role: "CASHIER", branch: BRANCH, permissions: CASHIER });
const finance = (permissions: PermissionKey[] = ["product.read", "product.update.price", "order.read.all", ODOO_RETRY]) =>
  makeUser({ username: "finance", displayName: "Finance", role: "FINANCE", branch: null, permissions });

const SYSTEM_WEB = { id: "00000000-0000-4000-8000-0000000000w1", username: "system.web", displayName: "Website orders" };
const CASHIER_REF = { id: "00000000-0000-4000-8000-0000000000c2", username: "bo.cashier", displayName: "BO Cashier" };
const CHARGE = "chg_TS05A4120230736x9K22710693";
const SECOND_CHARGE = "chg_TS07A5520230736Lm9P88214475";

/** A web order paid by card, confirmed by the payment, not yet collected, already in Odoo. */
function webOrder(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "00000000-0000-4000-8000-0000000000b7",
    code: "BO-000007",
    number: 7,
    status: "CONFIRMED",
    source: "WEB",
    paymentStatus: "PAID",
    paidAt: "2031-03-10T09:05:00.000Z",
    collectedAt: null,
    customerName: "Sara Ali",
    customerPhone: "+97455123456",
    customerEmail: "sara@example.com",
    collectedBy: null,
    payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: null, refundId: null, testMode: false },
    odoo: { status: "DONE", saleOrderId: 4711, attempts: 1, lastError: null, nextAttemptAt: null },
    total: "619.50",
    currency: "QAR",
    itemCount: 2,
    branch: BRANCH,
    createdBy: SYSTEM_WEB,
    confirmedBy: SYSTEM_WEB,
    confirmedAt: "2031-03-10T09:05:00.000Z",
    cancelledBy: null,
    cancelledAt: null,
    createdAt: "2031-03-10T09:00:00.000Z",
    updatedAt: "2031-03-10T09:05:00.000Z",
    items: [
      { id: "line-1", productId: "p-cam", productName: "4K Dash Cam (Front & Rear)", barcode: "6291041500244", thumbUrl: "/api/uploads/cam-sm.webp", unitPrice: "499.00", quantity: 1, lineTotal: "499.00" },
      { id: "line-2", productId: "p-mats", productName: "3D Floor Mats", barcode: null, thumbUrl: "/api/uploads/mats-sm.webp", unitPrice: "120.50", quantity: 1, lineTotal: "120.50" },
    ],
    ...overrides,
  };
}

/** Serves the order (and its later versions) and counts the reads. */
function serve(...versions: OrderDetail[]) {
  const reads = { count: 0 };
  server.use(
    http.get("/api/orders/:id", () => {
      const order = versions[Math.min(reads.count, versions.length - 1)];
      reads.count += 1;
      return HttpResponse.json(order);
    }),
  );
  return reads;
}

async function openSheet(order: OrderDetail, user = boCashier()) {
  // a toaster too, so a message is found whether it is a toast or a line in the sheet
  const view = renderWithApp(
    <>
      <OrderDetailSheet orderId={order.id} onClose={vi.fn()} />
      <Toaster />
    </>,
    { user },
  );
  const sheet = await screen.findByRole("dialog", { name: /Order .*BO-000007/ });
  await within(sheet).findByText("Sara Ali");
  return { ...view, sheet };
}

describe("order detail: web orders", () => {
  it("shows how to reach the customer: the phone as a tel: link and the email", async () => {
    const order = webOrder();
    serve(order);
    const { sheet } = await openSheet(order);
    const phone = within(sheet).getByRole("link", { name: /55\s?12\s?34\s?56|5512\s?3456/ });
    expect(phone).toHaveAttribute("href", "tel:+97455123456");
    expect(within(sheet).getByText("sara@example.com")).toBeInTheDocument();
    expect(within(sheet).getByText("Phone")).toBeInTheDocument();
    expect(within(sheet).getByText("Email")).toBeInTheDocument();
  });

  it("shows the card payment with the last 8 characters of Tap's charge id", async () => {
    const order = webOrder();
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).getByText("Payment")).toBeInTheDocument();
    expect(within(sheet).getByText(/22710693/)).toBeInTheDocument();
    expect(within(sheet).queryByText(new RegExp(CHARGE))).not.toBeInTheDocument();
  });

  it("warns that Tap charged another amount, so the cashier cancels (and refunds) the order", async () => {
    const order = webOrder({
      status: "PENDING",
      paymentStatus: "PENDING",
      paidAt: null,
      confirmedBy: null,
      confirmedAt: null,
      payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: "AMOUNT_MISMATCH", refundId: null, testMode: false },
      odoo: null,
    });
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).getByText("Tap charged a different amount than the order total. Cancel the order to refund the customer.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
  });

  it("flags a second charge on a paid order so staff refund that charge in Tap", async () => {
    // plan Task 6: the order stays paid by the first charge; the newest attempt is the duplicate
    const order = webOrder({ payment: { chargeId: SECOND_CHARGE, status: "CAPTURED", failureCode: "DUPLICATE_CAPTURE", refundId: null, testMode: false } });
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).getByText("Charged twice — refund this charge in Tap")).toBeInTheDocument();
    expect(within(sheet).getByText(/88214475/)).toBeInTheDocument();
  });

  it("shows a refunded payment with its refund", async () => {
    const order = webOrder({
      status: "CANCELLED",
      paymentStatus: "REFUNDED",
      cancelledBy: CASHIER_REF,
      cancelledAt: "2031-03-10T10:00:00.000Z",
      payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: null, refundId: "rf_fake_12345678", testMode: false },
    });
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).getAllByText("Refunded").length).toBeGreaterThan(0);
    expect(within(sheet).getByText(/12345678/)).toBeInTheDocument();
  });

  it("shows why the last card attempt failed", async () => {
    const order = webOrder({
      status: "PENDING",
      paymentStatus: "PENDING",
      paidAt: null,
      confirmedBy: null,
      confirmedAt: null,
      odoo: null,
      payment: { chargeId: CHARGE, status: "FAILED", failureCode: "DECLINED", refundId: null, testMode: false },
    });
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).getByText(/DECLINED/)).toBeInTheDocument();
  });

  // regexes: interpolated values may be wrapped in bidi isolates (FSI…PDI), as isolate() does elsewhere in the sheet
  it.each([
    ["DONE", { status: "DONE", saleOrderId: 4711, attempts: 1, lastError: null, nextAttemptAt: null }, /Sale order .*4711.* created in Odoo/],
    ["PENDING", { status: "PENDING", saleOrderId: null, attempts: 2, lastError: "boom", nextAttemptAt: "2031-03-10T09:20:00.000Z" }, /Waiting to be sent to Odoo/],
    ["FAILED", { status: "FAILED", saleOrderId: null, attempts: 1, lastError: "PRODUCT_NOT_IN_ODOO: 3D Floor Mats", nextAttemptAt: null }, /Odoo rejected it: .*PRODUCT_NOT_IN_ODOO: 3D Floor Mats/],
  ] as const)("shows where the order stands in Odoo: %s", async (_status, odoo, text) => {
    const order = webOrder({ odoo: { ...odoo } });
    serve(order);
    const { sheet } = await openSheet(order, finance(["order.read.all"]));
    expect(within(sheet).getByText(text)).toBeInTheDocument();
  });

  it("shows when a pending order will next be sent to Odoo", async () => {
    const order = webOrder({ odoo: { status: "PENDING", saleOrderId: null, attempts: 2, lastError: "boom", nextAttemptAt: "2031-03-10T09:20:00.000Z" } });
    serve(order);
    const { sheet } = await openSheet(order, finance(["order.read.all"]));
    expect(within(sheet).getByText(/Waiting to be sent to Odoo/)).toBeInTheDocument();
    // 09:20Z is 12:20 in Asia/Qatar
    expect(within(sheet).getByText(/12:20/)).toBeInTheDocument();
  });

  it("says when Odoo writing is not set up", async () => {
    const order = webOrder({ odoo: { status: "PENDING", saleOrderId: null, attempts: 0, lastError: "ODOO_WRITE_NOT_CONFIGURED", nextAttemptAt: "2031-03-10T10:05:00.000Z" } });
    serve(order);
    const { sheet } = await openSheet(order, finance(["order.read.all"]));
    expect(within(sheet).getByText("Odoo writing is not set up.")).toBeInTheDocument();
  });

  it("lets Finance send a failed order to Odoo again, and reloads it", async () => {
    const failed = webOrder({ odoo: { status: "FAILED", saleOrderId: null, attempts: 24, lastError: "boom", nextAttemptAt: null } });
    const retried = webOrder({ odoo: { status: "PENDING", saleOrderId: null, attempts: 24, lastError: null, nextAttemptAt: "2031-03-10T11:00:00.000Z" } });
    const reads = serve(failed, retried);
    let retries = 0;
    server.use(
      http.post("/api/orders/:id/odoo/retry", ({ params }) => {
        retries += 1;
        expect(params.id).toBe(failed.id);
        return HttpResponse.json(retried);
      }),
    );
    const { sheet, user } = await openSheet(failed, finance());
    await user.click(within(sheet).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Queued for Odoo again")).toBeInTheDocument();
    await waitFor(() => expect(retries).toBe(1));
    await waitFor(() => expect(within(sheet).getByText(/Waiting to be sent to Odoo/)).toBeInTheDocument());
    await waitFor(() => expect(reads.count).toBeGreaterThan(1));
  });

  it("offers Retry only to those with order.odoo.retry", async () => {
    const failed = webOrder({ odoo: { status: "FAILED", saleOrderId: null, attempts: 24, lastError: "boom", nextAttemptAt: null } });
    serve(failed);
    const { sheet } = await openSheet(failed, finance(["order.read.all"]));
    expect(within(sheet).getByText(/Odoo rejected it: .*boom/)).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("offers Collected only to those with order.confirm", async () => {
    const order = webOrder();
    serve(order);
    const { sheet } = await openSheet(order, finance(["order.read.all"]));
    expect(within(sheet).getAllByText("Paid").length).toBeGreaterThan(0);
    expect(within(sheet).queryByRole("button", { name: "Mark as collected" })).not.toBeInTheDocument();
  });

  it("lets the cashier mark a paid web order as collected", async () => {
    const order = webOrder();
    const collected = webOrder({ collectedAt: "2031-03-10T12:00:00.000Z", collectedBy: CASHIER_REF });
    serve(order, collected);
    let collects = 0;
    server.use(
      http.post("/api/orders/:id/collect", () => {
        collects += 1;
        return HttpResponse.json(collected);
      }),
    );
    const { sheet, user } = await openSheet(order);
    await user.click(within(sheet).getByRole("button", { name: "Mark as collected" }));
    // a confirmation step is allowed; it confirms with the same words
    const confirm = screen.queryByRole("alertdialog");
    if (confirm) await user.click(within(confirm).getByRole("button", { name: "Mark as collected" }));

    await waitFor(() => expect(collects).toBe(1));
    expect(await within(sheet).findByText(/Collected by .*BO Cashier/)).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Mark as collected" })).not.toBeInTheDocument();
  });

  it("offers Collected only for paid web orders not yet collected", async () => {
    const unpaid = webOrder({ status: "PENDING", paymentStatus: "PENDING", paidAt: null, confirmedBy: null, confirmedAt: null, payment: null, odoo: null });
    serve(unpaid);
    const { sheet } = await openSheet(unpaid);
    expect(within(sheet).getAllByText("Awaiting payment").length).toBeGreaterThan(0);
    expect(within(sheet).queryByRole("button", { name: "Mark as collected" })).not.toBeInTheDocument();
  });

  it("shows a web order cancelled before it was paid as cancelled, not awaiting payment", async () => {
    const expired = webOrder({
      status: "CANCELLED",
      paymentStatus: "PENDING",
      paidAt: null,
      confirmedBy: null,
      confirmedAt: null,
      cancelledBy: SYSTEM_WEB,
      cancelledAt: "2031-03-10T09:30:00.000Z",
      payment: null,
      odoo: null,
    });
    serve(expired);
    const { sheet } = await openSheet(expired);
    expect(within(sheet).getByText("Cancelled")).toBeInTheDocument();
    expect(within(sheet).queryByText("Awaiting payment")).not.toBeInTheDocument();
  });

  it("shows an order paid after it expired as paid, without the expiry's cancellation", async () => {
    // the webhook captured it after the 30-minute expiry: confirmed and paid, cancelledAt kept from the expiry
    const latePaid = webOrder({ paidAt: "2031-03-10T10:00:00.000Z", cancelledBy: SYSTEM_WEB, cancelledAt: "2031-03-10T09:30:00.000Z" });
    serve(latePaid);
    const { sheet } = await openSheet(latePaid);
    expect(within(sheet).getAllByText("Paid").length).toBeGreaterThan(0);
    expect(within(sheet).queryByText(/Cancelled by/)).not.toBeInTheDocument();
  });

  it("never offers Edit or Confirm on a web order: the card payment confirms it", async () => {
    const unpaid = webOrder({ status: "PENDING", paymentStatus: "PENDING", paidAt: null, confirmedBy: null, confirmedAt: null, payment: null, odoo: null });
    serve(unpaid);
    const { sheet } = await openSheet(unpaid);
    expect(within(sheet).getByRole("link", { name: /55\s?12\s?34\s?56|5512\s?3456/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Edit order" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Confirm order" })).not.toBeInTheDocument();
    // the cashier may still cancel an unpaid web order
    expect(within(sheet).getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
  });
});

describe("order detail: web orders, money and Odoo (fix round 1)", () => {
  const admin = () =>
    makeUser({
      username: "admin",
      displayName: "Admin",
      role: "SUPER_ADMIN",
      branch: null,
      permissions: ["order.read.all", "order.update", "order.cancel", "order.confirm", "order.receipt.download"],
    });
  const refundedCopy = "The order will be cancelled and the card payment refunded to the customer. This can't be undone.";

  it("tells the Super Admin that cancelling a paid web order refunds the card, then says it did", async () => {
    const order = webOrder();
    const refunded = webOrder({
      status: "CANCELLED",
      paymentStatus: "REFUNDED",
      cancelledBy: CASHIER_REF,
      cancelledAt: "2031-03-10T10:00:00.000Z",
      payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: null, refundId: "rf_fake_12345678", testMode: false },
    });
    serve(order, refunded);
    let cancels = 0;
    server.use(
      http.post("/api/orders/:id/cancel", () => {
        cancels += 1;
        return HttpResponse.json(refunded);
      }),
    );
    const { sheet, user } = await openSheet(order, admin());
    await user.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Cancel order .*BO-000007.*\?/ });
    expect(within(dialog).getByText(refundedCopy)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    await waitFor(() => expect(cancels).toBe(1));
    expect(await screen.findByText("Order BO-000007 cancelled and the payment refunded")).toBeInTheDocument();
  });

  it("tells the cashier that cancelling an order Tap charged the wrong amount refunds that charge", async () => {
    const order = webOrder({
      status: "PENDING",
      paymentStatus: "PENDING",
      paidAt: null,
      confirmedBy: null,
      confirmedAt: null,
      payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: "AMOUNT_MISMATCH", refundId: null, testMode: false },
      odoo: null,
    });
    serve(order);
    const { sheet, user } = await openSheet(order);
    await user.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(refundedCopy)).toBeInTheDocument();
  });

  it("keeps the plain cancel text for an unpaid web order (nothing to refund)", async () => {
    const order = webOrder({ status: "PENDING", paymentStatus: "PENDING", paidAt: null, confirmedBy: null, confirmedAt: null, payment: null, odoo: null });
    serve(order);
    const { sheet, user } = await openSheet(order);
    await user.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("The order will be marked as cancelled. This can't be undone.")).toBeInTheDocument();
    expect(within(dialog).queryByText(refundedCopy)).not.toBeInTheDocument();
  });

  it("explains a refund Tap refused, and leaves the order paid", async () => {
    const order = webOrder();
    serve(order);
    server.use(
      http.post("/api/orders/:id/cancel", () =>
        HttpResponse.json({ statusCode: 502, error: "Bad Gateway", code: "REFUND_FAILED", message: "The refund did not go through." }, { status: 502 }),
      ),
    );
    const { sheet, user } = await openSheet(order, admin());
    await user.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    expect(await screen.findByText("The refund did not go through, so the order was not cancelled. Try again, or refund it in Tap.")).toBeInTheDocument();
    // the dialog stays open for another try, and the order still reads as paid
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(within(sheet).getAllByText("Paid").length).toBeGreaterThan(0);
  });

  it("asks before marking an order collected, and does nothing when the cashier backs out", async () => {
    const order = webOrder();
    serve(order);
    let collects = 0;
    server.use(
      http.post("/api/orders/:id/collect", () => {
        collects += 1;
        return HttpResponse.json(order);
      }),
    );
    const { sheet, user } = await openSheet(order);
    await user.click(within(sheet).getByRole("button", { name: "Mark as collected" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Mark order .*BO-000007.* as collected\?/ });
    expect(within(dialog).getByText("Only do this when the customer has the parts in hand. This can't be undone.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(collects).toBe(0);
    expect(within(sheet).getByRole("button", { name: "Mark as collected" })).toBeInTheDocument();
  });

  it("says a refunded order was not sent to Odoo, as a note rather than an Odoo failure, without Retry", async () => {
    const order = webOrder({
      status: "CANCELLED",
      paymentStatus: "REFUNDED",
      cancelledBy: CASHIER_REF,
      cancelledAt: "2031-03-10T10:00:00.000Z",
      payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: null, refundId: "rf_fake_12345678", testMode: false },
      odoo: { status: "FAILED", saleOrderId: null, attempts: 0, lastError: "ORDER_REFUNDED", nextAttemptAt: null },
    });
    serve(order);
    const { sheet } = await openSheet(order, finance());
    const note = within(sheet).getByText("Not sent to Odoo: the order was refunded.");
    expect(note.closest("p")).not.toHaveClass("text-danger");
    expect(within(sheet).queryByText(/Odoo rejected it/)).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("warns when a cancelled order's card was charged the wrong amount and never refunded", async () => {
    // it expired before Tap's mismatched capture arrived: nobody refunded it, so staff do it in Tap
    const order = webOrder({
      status: "CANCELLED",
      paymentStatus: "PENDING",
      paidAt: null,
      confirmedBy: null,
      confirmedAt: null,
      cancelledBy: SYSTEM_WEB,
      cancelledAt: "2031-03-10T09:30:00.000Z",
      payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: "AMOUNT_MISMATCH", refundId: null, testMode: false },
      odoo: null,
    });
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).getByText("This card was charged but the order is cancelled. Refund the charge in Tap.")).toBeInTheDocument();
    expect(within(sheet).queryByText(/Cancel the order to refund/)).not.toBeInTheDocument();
  });

  it("shows a pending Odoo row's last failure and how many attempts it took", async () => {
    const order = webOrder({ odoo: { status: "PENDING", saleOrderId: null, attempts: 2, lastError: "connect ECONNREFUSED", nextAttemptAt: "2031-03-10T09:20:00.000Z" } });
    serve(order);
    const { sheet } = await openSheet(order, finance(["order.read.all"]));
    expect(within(sheet).getByText(/Waiting to be sent to Odoo/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Attempt .*2.* failed: .*connect ECONNREFUSED/)).toBeInTheDocument();
  });

  it("shows only the set-up note, not an attempt failure, while Odoo writing is off", async () => {
    const order = webOrder({ odoo: { status: "PENDING", saleOrderId: null, attempts: 3, lastError: "ODOO_WRITE_NOT_CONFIGURED", nextAttemptAt: "2031-03-10T10:05:00.000Z" } });
    serve(order);
    const { sheet } = await openSheet(order, finance(["order.read.all"]));
    expect(within(sheet).getByText("Odoo writing is not set up.")).toBeInTheDocument();
    expect(within(sheet).queryByText(/Attempt .* failed/)).not.toBeInTheDocument();
  });
});

describe("order detail: what the counter must know (final review)", () => {
  const admin = () =>
    makeUser({
      username: "admin",
      displayName: "Admin",
      role: "SUPER_ADMIN",
      branch: null,
      permissions: ["order.read.all", "order.update", "order.cancel", "order.confirm", "order.receipt.download"],
    });
  const PAID_ONLINE = "Paid online — nothing to collect at the till";
  const refunded = (odoo: OrderDetail["odoo"]) =>
    webOrder({
      status: "CANCELLED",
      paymentStatus: "REFUNDED",
      cancelledBy: CASHIER_REF,
      cancelledAt: "2031-03-10T10:00:00.000Z",
      payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: null, refundId: "rf_fake_12345678", testMode: false },
      odoo,
    });
  const showroomOrder = () =>
    webOrder({ source: "SHOWROOM", paymentStatus: "NONE", paidAt: null, customerPhone: null, customerEmail: null, payment: null, odoo: null, createdBy: CASHIER_REF, confirmedBy: CASHIER_REF });

  it("tells the cashier a paid web order has nothing to collect at the till", async () => {
    const order = webOrder();
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).getByText(PAID_ONLINE)).toBeInTheDocument();
  });

  it.each([
    ["an unpaid web order", webOrder({ status: "PENDING", paymentStatus: "PENDING", paidAt: null, confirmedBy: null, confirmedAt: null, payment: null, odoo: null })],
    ["a refunded web order", refunded({ status: "FAILED", saleOrderId: null, attempts: 0, lastError: "ORDER_REFUNDED", nextAttemptAt: null })],
    ["a showroom order", showroomOrder()],
  ])("says nothing about the till for %s", async (_label, order) => {
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).queryByText(PAID_ONLINE)).not.toBeInTheDocument();
  });

  it("shows no bars to scan on a web order (the card paid it), and keeps them on a showroom order", async () => {
    const web = webOrder();
    serve(web);
    const first = await openSheet(web);
    expect(within(first.sheet).queryByText("6291041500244")).not.toBeInTheDocument();
    expect(first.sheet.querySelector("svg[aria-label*='6291041500244'], svg title")).toBeNull();
    first.unmount();

    const showroom = showroomOrder();
    serve(showroom);
    const { sheet } = await openSheet(showroom);
    expect(within(sheet).getByText("6291041500244")).toBeInTheDocument();
  });

  it("warns when an order was refunded after it reached Odoo, naming the sale order to cancel there", async () => {
    const order = refunded({ status: "DONE", saleOrderId: 4711, attempts: 1, lastError: null, nextAttemptAt: null });
    serve(order);
    const { sheet } = await openSheet(order, finance());
    const warning = within(sheet).getByText(/^Refunded after it reached Odoo: cancel sale order .?4711.? in Odoo$/);
    expect(warning.closest("p")).toHaveClass("text-warning");
    // not only the green "created in Odoo" line
    expect(within(sheet).queryByText(/Sale order .*4711.* created in Odoo/)).not.toBeInTheDocument();
  });

  it("keeps the green Odoo line for a paid order that is in Odoo", async () => {
    const order = webOrder();
    serve(order);
    const { sheet } = await openSheet(order, finance());
    expect(within(sheet).getByText(/Sale order .*4711.* created in Odoo/)).toBeInTheDocument();
    expect(within(sheet).queryByText(/Refunded after it reached Odoo/)).not.toBeInTheDocument();
  });

  it("says in the refund dialog that an order already in Odoo must be cancelled there too", async () => {
    const order = webOrder();
    serve(order);
    const { sheet, user } = await openSheet(order, admin());
    await user.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("The order will be cancelled and the card payment refunded to the customer. This can't be undone.")).toBeInTheDocument();
    expect(within(dialog).getByText(/^It is already in Odoo: after the refund, cancel sale order .?4711.? in Odoo\.$/)).toBeInTheDocument();
  });

  it("leaves the Odoo note out of the refund dialog while the order is not in Odoo yet", async () => {
    const order = webOrder({ odoo: { status: "PENDING", saleOrderId: null, attempts: 0, lastError: null, nextAttemptAt: "2031-03-10T09:06:00.000Z" } });
    serve(order);
    const { sheet, user } = await openSheet(order, admin());
    await user.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByText(/already in Odoo/)).not.toBeInTheDocument();
  });

  it("marks a payment made in Tap's test mode with a TEST badge", async () => {
    const order = webOrder({ payment: { chargeId: CHARGE, status: "CAPTURED", failureCode: null, refundId: null, testMode: true } });
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).getByText("TEST")).toBeInTheDocument();
  });

  it("shows no TEST badge on a live payment", async () => {
    const order = webOrder();
    serve(order);
    const { sheet } = await openSheet(order);
    expect(within(sheet).queryByText("TEST")).not.toBeInTheDocument();
  });
});
