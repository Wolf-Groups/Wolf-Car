import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { apiEnv } from "./env";

/**
 * Fresh demo data for every run: apply migrations (non-destructive) and run the
 * seed, with its made-up demo catalogue, against the dedicated e2e database
 * (the seed empties it first).
 *
 * Runs as the first half of the API's webServer command, because Playwright
 * starts web servers before globalSetup and the API needs its tables at boot.
 *
 * The web's data cache goes too: `next start` keeps the public catalogue it
 * fetched (revalidate 60 s) in .next/cache/fetch-cache across runs and serves
 * it stale-while-revalidate, so the first catalogue page of a new run would
 * offer the last run's product ids, which the reseed replaced (the checkout
 * then answers PRODUCT_UNAVAILABLE). Playwright starts the web server only
 * after this command's API is up.
 */
const cwd = path.join(__dirname, "..", "api");
const env = { ...apiEnv(), NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;
rmSync(path.join(cwd, "storage", "e2e-uploads"), { recursive: true, force: true });
rmSync(path.join(__dirname, "..", ".next", "cache", "fetch-cache"), { recursive: true, force: true });
execSync("npx prisma migrate deploy", { cwd, env, stdio: "pipe" });
execSync("npx tsx prisma/seed.ts", {
  cwd,
  env: { ...env, UPLOAD_DIR: "./storage/e2e-uploads", SEED_DEMO_CATALOG: "1" },
  stdio: "pipe",
});
