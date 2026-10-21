import path from "node:path";
import { ACCOUNTS, expect, signIn, test } from "./fixtures/test";

/**
 * The online checkout end to end, against the API's in-memory payment gateway
 * (PAYMENTS_PROVIDER=fake, see e2e/env.ts) and a stand-in for Tap's card form
 * (fixtures/tap-sdk-stub.js): a visitor pays for a part by card and the Bin
 * Omran cashier finds the paid web order.
 *
 * Every product of the demo seed (SEED_DEMO_CATALOG=1) is on both branches'
 * lists, so a priced one like the Oil Filter is accepted by the Bin Omran
 * checkout; the unpriced ones and the protection packages (service rows) are not.
 */
const PRODUCT = { name: "Oil Filter", price: "35.00", total: /QAR\s35\.00/ };
const CUSTOMER = { name: "Sara Ali", email: "sara@example.com" };
/** Tap's card SDK CDN and its API: the stub and the fake gateway stand in for both */
const TAP_HOST = /(^|\.)tap\.company$|^tap-sdks\.b-cdn\.net$/;

test("a customer pays for parts by card and the cashier sees it", async ({ page }) => {
  // the seed does not empty the customer tables, and one phone may ask for 3 codes per 15 min:
  // a fresh mobile number per run keeps reruns away from OTP_TOO_MANY
  const phone = `5${String(Date.now()).slice(-7)}`;
  await page.addInitScript({ path: path.join(__dirname, "fixtures", "tap-sdk-stub.js") });
  const toTap: string[] = [];
  page.on("request", (r) => {
    if (TAP_HOST.test(new URL(r.url()).hostname)) toTap.push(r.url());
  });
  let orderCode = "";

  await test.step("the visitor puts a part in the basket and chooses to pay by card", async () => {
    await page.goto("/en/products");
    const card = page.getByTestId("catalog-grid").getByRole("listitem").filter({ hasText: PRODUCT.name });
    await card.getByRole("button", { name: "Add to cart" }).click();
    await page.getByRole("button", { name: /View cart/ }).click();
    await page.getByRole("link", { name: "Pay by card" }).click();
    await expect(page).toHaveURL(/\/en\/checkout$/);
  });

  await test.step("signs in with the code sent to the phone", async () => {
    await page.getByLabel("Mobile number").fill(phone);
    // the console SMS sender's code comes back in the API's answer (OTP_DEV_CODE_IN_RESPONSE=true)
    const sent = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/shop/otp" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Send code" }).click();
    const answer = await sent;
    expect(answer.status()).toBe(200);
    const { devCode } = (await answer.json()) as { devCode?: string };
    expect(devCode).toMatch(/^\d{6}$/);
    await expect(page.getByText(/We sent a 6-digit code to/)).toBeVisible();
    await page.getByLabel("Verification code").pressSequentially(devCode ?? "");
  });

  await test.step("gives a name and email and sees the server's total", async () => {
    await page.getByLabel("Full name").fill(CUSTOMER.name);
    await page.getByLabel("Email", { exact: true }).fill(CUSTOMER.email);
    const created = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/shop/orders" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Continue to payment" }).click();
    const order = await created;
    expect(order.ok()).toBe(true);
    // the browser sends ids and quantities only; the price is the server's
    const { items } = order.request().postDataJSON() as { items: Record<string, unknown>[] };
    expect(items.map((i) => Object.keys(i).sort())).toEqual([["productId", "quantity"]]);
    expect(await order.json()).toMatchObject({ total: PRODUCT.price, currency: "QAR" });
    await expect(page.getByRole("button", { name: "Pay now" })).toBeEnabled();
    await expect(page.getByText(PRODUCT.total).first()).toBeVisible();
    await expect(page.getByText(/Collect from .*Bin Omran/)).toBeVisible();
  });

  await test.step("pays and comes back to a paid order with its code", async () => {
    await page.getByRole("button", { name: "Pay now" }).click();
    await page.waitForURL(/\/en\/checkout\/return\?order=[0-9a-f-]{36}$/);
    await expect(page.getByText("Payment received")).toBeVisible({ timeout: 10_000 });
    const code = page.getByText(/^BO-\d{6}$/);
    await expect(code).toBeVisible();
    orderCode = (await code.innerText()).trim();
    await expect(page.getByText("Show this code at the branch when you collect your parts.")).toBeVisible();
    // the payment emptied the basket (the checkout reads it in the browser, after the session check,
    // so this message cannot show before hydration the way a missing "View cart" button could)
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
