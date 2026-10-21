import { ACCOUNTS, expect, signIn, test } from "./fixtures/test";

test.describe("sign-in and role landing pages", () => {
  test("signed-out visitors are sent to the login page", async ({ page }) => {
    await page.goto("/en/dashboard/orders");
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fdashboard%2Forders/);
    await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  });

  const landing = [
    ["admin", ACCOUNTS.admin, /\/en\/dashboard$/],
    ["finance", ACCOUNTS.finance, /\/en\/dashboard\/products$/],
    ["branch manager", ACCOUNTS.ghManager, /\/en\/dashboard\/products$/],
    ["cashier", ACCOUNTS.ghCashier, /\/en\/dashboard\/orders$/],
  ] as const;
  for (const [role, account, url] of landing) {
    test(`${role} lands on their dashboard`, async ({ page }) => {
      await signIn(page, account.username, account.password);
      await expect(page).toHaveURL(url);
    });
  }

  test("wrong password shows a clear inline error", async ({ page }) => {
    await page.goto("/en/login");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Wrong username or password.");
  });

  test("the navigation only offers what the role may use", async ({ page }) => {
    await signIn(page, ACCOUNTS.ghCashier.username, ACCOUNTS.ghCashier.password);
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Products" })).toHaveCount(0);
  });

  test("Arabic dashboard renders right-to-left", async ({ page }) => {
    await signIn(page, ACCOUNTS.admin.username, ACCOUNTS.admin.password, "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("مرحبًا");
  });
});

test.describe("public catalog", () => {
  test("is linked from the landing page footer and shows prices but never barcodes", async ({ page, request }) => {
    await page.goto("/en");
    const footerLinks = page.locator("footer nav");
    await expect(footerLinks.getByRole("link", { name: "Product catalog" })).toHaveAttribute("href", "/en/products");
    // staff open /login themselves: the public site does not advertise it
    await expect(footerLinks.locator('a[href="/en/login"]')).toHaveCount(0);

    await footerLinks.getByRole("link", { name: "Product catalog" }).click();
    await expect(page).toHaveURL(/\/en\/products$/);
    const cards = page.getByTestId("catalog-grid").getByRole("listitem");
    await expect(cards).toHaveCount(13);
    const text = await page.locator("main").innerText();
    expect(text).toMatch(/QAR\s1,800\.00/);
    expect(text).not.toMatch(/6291041500213/);

    const api = await request.get("/api/public/products");
    const body = await api.text();
    expect(body).not.toMatch(/"barcode"|6291041500213/);
    for (const product of JSON.parse(body) as Record<string, unknown>[]) {
      expect(Object.keys(product).sort()).toEqual(["categoryId", "description", "groupId", "id", "imageUrl", "name", "price", "thumbUrl", "variantColor", "variantLabel"]);
    }
  });

  test("sends the cart to the Bin Omran branch on WhatsApp", async ({ page }) => {
    await page.goto("/en/products");
    const card = page.getByTestId("catalog-grid").getByRole("listitem").filter({ hasText: "Oil Filter" });
    await card.getByRole("button", { name: "Add to cart" }).click();
    await card.getByRole("button", { name: "Increase quantity" }).click();
    await page.getByRole("button", { name: /View cart/ }).click();

    const order = page.getByRole("link", { name: "Order on WhatsApp · Bin Omran" });
    const href = decodeURIComponent((await order.getAttribute("href")) ?? "");
    expect(href).toContain("https://wa.me/97471008939?text=");
    expect(href).toMatch(/1\. Oil Filter × 2 — QAR\s70\.00/);
    expect(href).toMatch(/Total: QAR\s70\.00/);

    // the basket survives a reload
    await page.reload();
    await expect(page.getByRole("button", { name: /View cart/ })).toBeVisible();
  });

  test("is available in Arabic", async ({ page }) => {
    await page.goto("/ar/products");
    await expect(page.getByRole("heading", { name: "كل القطع والإكسسوارات" })).toBeVisible();
  });
});

test.describe("protection packages", () => {
  test("are linked from the landing page and the catalogue, and go into the same basket as parts", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("header").getByRole("link", { name: "Packages" })).toHaveAttribute("href", "/en/packages");
    await page.locator("#services").getByRole("link", { name: "See packages & prices" }).click();
    await expect(page).toHaveURL(/\/en\/packages$/);

    const bundle = page.locator("#complete li").filter({ has: page.getByRole("heading", { name: "Package 2" }) });
    await bundle.getByRole("button", { name: "Add to order" }).click();
    await page.getByRole("button", { name: "SUV / 4×4" }).click();
    await page.getByRole("button", { name: "Add Full front protection · German film · Premium · SUV / 4×4 to your order" }).click();

    // a part from the catalogue joins the same WhatsApp order
    await page.goto("/en/products");
    await expect(page.getByRole("link", { name: /Protection packages/ })).toHaveAttribute("href", "/en/packages");
    const card = page.getByTestId("catalog-grid").getByRole("listitem").filter({ hasText: "Oil Filter" });
    await card.getByRole("button", { name: "Add to cart" }).click();
    await page.getByRole("button", { name: /View cart/ }).click();

    const href = decodeURIComponent((await page.getByRole("link", { name: "Order on WhatsApp · Bin Omran" }).getAttribute("href")) ?? "");
    expect(href).toMatch(/1\. Package 2 · complete protection · German film × 1 — QAR\s6,999\.00/);
    expect(href).toMatch(/2\. Full front protection · German film · Premium · SUV \/ 4×4 × 1 — QAR\s3,500\.00/);
    expect(href).toMatch(/3\. Oil Filter × 1 — QAR\s35\.00/);
    expect(href).toMatch(/Total: QAR\s10,534\.00/);
  });

  test("are available in Arabic", async ({ page }) => {
    await page.goto("/ar/packages");
    await expect(page.getByRole("heading", { name: "باقات الحماية المتكاملة" })).toBeVisible();
    await expect(page.getByRole("button", { name: "فورويل" })).toHaveAttribute("aria-pressed", "false");
  });
});
