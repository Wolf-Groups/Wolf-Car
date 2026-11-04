import { expect, test } from "@playwright/test";

// every page, the public ones too: browsers keep to HTTPS once they have seen the site
// (as the API already asks), never guess a content type, and are not told what serves it
test.describe("security headers", () => {
  for (const path of ["/ar", "/en/products", "/ar/checkout", "/ar/checkout/return", "/en/login", "/ar/account"]) {
    test(`${path} is sent with HSTS and nosniff, without X-Powered-By`, async ({ request }) => {
      const headers = (await request.get(path)).headers();
      expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }
});
