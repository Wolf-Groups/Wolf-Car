import { expect, test } from "@playwright/test";

// The landing header holds the logo, the page links (from 1280px), "Our app" and the buttons on
// one line: nothing wraps onto a second line, nothing sticks out of the bar.
test.describe("landing header", () => {
  for (const locale of ["ar", "en"]) {
    for (const width of [1024, 1180, 1280, 1440]) {
      test(`fits on one line in ${locale} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/${locale}`);
        const bar = page.locator("header > div").first();
        await expect(bar.getByRole("link", { name: locale === "ar" ? /تطبيقنا/ : /Our app/ })).toBeVisible();
        const fit = await bar.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const shown = [...el.querySelectorAll("a, button")].filter((n) => n.getClientRects().length > 0);
          return {
            overflow: el.scrollWidth - el.clientWidth,
            outside: shown.filter((n) => n.getBoundingClientRect().left < box.left - 1 || n.getBoundingClientRect().right > box.right + 1).map((n) => n.textContent),
            wrapped: shown.filter((n) => n.getBoundingClientRect().height > 48).map((n) => n.textContent),
          };
        });
        expect(fit.outside).toEqual([]);
        expect(fit.wrapped).toEqual([]);
        expect(fit.overflow).toBeLessThanOrEqual(1);
      });
    }
  }
});
