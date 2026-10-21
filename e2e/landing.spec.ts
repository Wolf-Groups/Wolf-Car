import { expect, test } from "./fixtures/test";

/**
 * The landing page must stay exactly as it was, apart from the two footer
 * links and the way into the protection packages (a "Packages" header link,
 * and the PPF service card's link). These snapshots were reviewed against the
 * pre-change baseline; any other visual change fails here.
 */
for (const locale of ["ar", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const [name, viewport] of [
      ["mobile", { width: 390, height: 844 }],
      ["desktop", { width: 1440, height: 900 }],
    ] as const) {
      test(`landing ${locale} ${theme} ${name}`, async ({ browser }) => {
        const context = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
        await context.addInitScript((t) => localStorage.setItem("theme", t), theme);
        const page = await context.newPage();
        await page.goto(`/${locale}`, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`landing-${locale}-${theme}-${name}.png`, { fullPage: true, animations: "disabled" });
        await context.close();
      });
    }
  }
}

test("outside the car-model cards, the landing page links to the catalogue once, in the footer, and never to the staff sign-in", async ({ page }) => {
  await page.goto("/en");
  const appLinks = page.locator(':not(#catalog *):is(a[href="/en/products"], a[href="/en/login"])');
  await expect(appLinks).toHaveCount(1);
  await expect(page.locator("footer").locator('a[href="/en/products"]')).toHaveCount(1);
});
