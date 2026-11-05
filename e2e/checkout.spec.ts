import path from "node:path";
import { ACCOUNTS, expect, signIn, test } from "./fixtures/test";

/**
 * The online checkout end to end, against the API's in-memory payment gateway
 * (PAYMENTS_PROVIDER=fake, see e2e/env.ts) and a stand-in for Tap's card form
 * (fixtures/tap-sdk-stub.js). Nobody signs in: a guest pays for a part by card,
 * another orders to pay at the branch, and the Bin Omran cashier finds both,
 * confirming and handing over the second.
 *
 * Every product of the demo seed (SEED_DEMO_CATALOG=1) is on both branches'
 * lists, so a priced one like the Oil Filter is accepted by the Bin Omran
 * checkout; the unpriced ones and the protection packages (service rows) are not.
 */
const PRODUCT = { name: "Oil Filter", price: "35.00", total: /QAR\s35\.00/ };
/** the Pay button says the amount */
const PAY = /^Pay QAR\s35\.00$/;
const CUSTOMER = { name: "Sara Ali", phone: "55123456", email: "sara@example.com" };
/** Tap's card SDK CDN and its API: the stub and the fake gateway stand in for both */
const TAP_HOST = /(^|\.)tap\.company$|^tap-sdks\.b-cdn\.net$/;
const ORDER_PAGE = /\/en\/checkout\/return\?order=[0-9a-f-]{36}&key=[A-Za-z0-9_-]{32}$/;

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(__dirname, "fixtures", "tap-sdk-stub.js") });
});

/** The visitor puts the part in the basket and opens the checkout. */
async function checkoutOnePart(page: import("@playwright/test").Page) {
  await page.goto("/en/products");
  const card = page.getByTestId("catalog-grid").getByRole("listitem").filter({ hasText: PRODUCT.name });
  await card.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await expect(page).toHaveURL(/\/en\/checkout$/);
}

async function fillDetails(page: import("@playwright/test").Page, email: string) {
  await page.getByLabel("Full name").fill(CUSTOMER.name);
  await page.getByLabel("Mobile number").fill(CUSTOMER.phone);
  await page.getByLabel("Email", { exact: true }).fill(email);
}

test("a guest pays for parts by card and the cashier sees it", async ({ page }) => {
  const toTap: string[] = [];
  page.on("request", (r) => {
    if (TAP_HOST.test(new URL(r.url()).hostname)) toTap.push(r.url());
  });
  let orderCode = "";

  await test.step("the visitor puts a part in the basket and goes to the checkout, without signing in", async () => {
    await checkoutOnePart(page);
    await expect(page.getByText("Have an account?")).toBeVisible();
  });

  await test.step("gives a name, mobile and email, keeps Pay now by card, and sees the server's total", async () => {
    await fillDetails(page, CUSTOMER.email);
    await expect(page.getByRole("radio", { name: /Pay now by card/ })).toBeChecked();
    const created = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/shop/orders" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Continue to payment" }).click();
    const order = await created;
    expect(order.ok()).toBe(true);
    // the browser sends ids and quantities only; the price is the server's
    const body = order.request().postDataJSON() as { items: Record<string, unknown>[]; paymentMethod: string; phone: string };
    expect(body.items.map((i) => Object.keys(i).sort())).toEqual([["productId", "quantity"]]);
    expect(body).toMatchObject({ paymentMethod: "card", phone: "+97455123456" });
    expect(await order.json()).toMatchObject({ total: PRODUCT.price, currency: "QAR" });
    await expect(page.getByRole("button", { name: PAY })).toBeEnabled();
    await expect(page.getByText(PRODUCT.total).first()).toBeVisible();
    await expect(page.getByText(/Collect from .*Bin Omran/)).toBeVisible();
  });

  await test.step("a reload (or Back from the bank's page) reopens the same order's pay step, by its key", async () => {
    await expect(page).toHaveURL(/\/en\/checkout\?order=[0-9a-f-]{36}&key=[A-Za-z0-9_-]{32}$/);
    let created = 0;
    const count = (r: { url(): string; method(): string }) => {
      if (new URL(r.url()).pathname === "/api/shop/orders" && r.method() === "POST") created += 1;
    };
    page.on("request", count);
    await page.reload();
    await expect(page.getByRole("button", { name: PAY })).toBeEnabled();
    await expect(page.getByLabel("Full name")).toHaveCount(0);
    page.off("request", count);
    expect(created).toBe(0);
  });

  await test.step("pays and lands on the thank-you page with the order code", async () => {
    await page.getByRole("button", { name: PAY }).click();
    await page.waitForURL(ORDER_PAGE);
    await expect(page.getByRole("heading", { name: "Thank you, Sara!" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Payment received")).toBeVisible();
    const code = page.getByText(/^BO-\d{6}$/);
    await expect(code).toBeVisible();
    orderCode = (await code.innerText()).trim();
    await expect(page.getByText(/We emailed your receipt to/)).toBeVisible();
    // the payment emptied the basket
    await page.goto("/en/checkout");
    await expect(page.getByText("Your cart is empty. Add some parts first.")).toBeVisible();
  });

  await test.step("the Bin Omran cashier finds it as a paid web order", async () => {
    await signIn(page, ACCOUNTS.boCashier.username, ACCOUNTS.boCashier.password);
    await expect(page).toHaveURL(/\/en\/dashboard\/orders$/);
    const open = page.getByRole("button", { name: `Open order ${orderCode}` });
    const row = page.getByRole("row").filter({ has: open });
    await expect(row).toContainText(CUSTOMER.name);
    // exact: the row also says "by Website orders" (the system.web user), which contains "Web"
    await expect(row.getByText("Web", { exact: true })).toBeVisible();
    await expect(row.getByText("Paid", { exact: true })).toBeVisible();
  });

  expect(toTap, "the browser never reached Tap").toEqual([]);
});

test("a guest orders to pay at the branch, and the cashier confirms and hands it over", async ({ page }) => {
  // a fresh email per run: one customer may hold 3 open pay-at-branch orders, and the seed keeps customers
  const email = `guest-${Date.now()}@example.com`;
  let orderCode = "";

  await test.step("the visitor chooses to pay at the branch and places the order", async () => {
    await checkoutOnePart(page);
    await fillDetails(page, email);
    await page.getByRole("radio", { name: /Pay at the branch when you collect/ }).check();
    await page.getByRole("button", { name: "Place order" }).click();
    await page.waitForURL(ORDER_PAGE);
    await expect(page.getByRole("heading", { name: "Thank you, Sara!" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Your order is placed")).toBeVisible();
    await expect(page.getByText(/We call you on .*5512 3456.* to confirm the order\./)).toBeVisible();
    const code = page.getByText(/^BO-\d{6}$/);
    orderCode = (await code.innerText()).trim();
  });

  await test.step("the cashier confirms it after the call, then hands it over once paid at the till", async () => {
    await signIn(page, ACCOUNTS.boCashier.username, ACCOUNTS.boCashier.password);
    await page.getByRole("button", { name: `Open order ${orderCode}` }).click();
    const sheet = page.getByRole("dialog", { name: new RegExp(`Order .*${orderCode}`) });
    await expect(sheet.getByText("Pay at branch").first()).toBeVisible();
    await sheet.getByRole("button", { name: "Confirm order" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm order" }).click();
    await sheet.getByRole("button", { name: "Mark as collected" }).click();
    const collect = page.getByRole("alertdialog");
    await expect(collect).toContainText(/Take the payment of .*35\.00.* at the till first/);
    await collect.getByRole("button", { name: "Mark as collected" }).click();
    await expect(sheet.getByText(/Collected by/)).toBeVisible();
  });
});
