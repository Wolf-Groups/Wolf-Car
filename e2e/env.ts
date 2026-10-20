import { readFileSync } from "node:fs";
import path from "node:path";

/** Ports and environment for the browser tests (separate from the dev servers). */
export const WEB_PORT = 3100;
export const API_PORT = 4100;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

function apiDotEnv(): Record<string, string> {
  try {
    const text = readFileSync(path.join(__dirname, "..", "api", ".env"), "utf8");
    return Object.fromEntries(
      text
        .split("\n")
        .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? apiDotEnv().E2E_DATABASE_URL;
  if (!url) throw new Error("Set E2E_DATABASE_URL (see api/.env.example)");
  const name = new URL(url).pathname.slice(1);
  if (!/e2e/i.test(name)) throw new Error(`Refusing to use "${name}" for browser tests: the database name must contain "e2e".`);
  return url;
}

/** Environment for the API process started by Playwright. */
export function apiEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    NODE_ENV: "production",
    PORT: String(API_PORT),
    DATABASE_URL: e2eDatabaseUrl(),
    CORS_ORIGINS: WEB_URL,
    TRUST_PROXY: "loopback",
    LOG_LEVEL: "warn",
    SWAGGER_ENABLED: "false",
    AUTH_THROTTLE_LIMIT: "1000",
    RATE_LIMIT_PER_MINUTE: "100000",
    UPLOAD_DIR: "./storage/e2e-uploads",
    // online checkout: the in-memory Tap stand-in, codes logged instead of texted,
    // and echoed in the answer (the API runs as production here, which would hide them)
    PAYMENTS_PROVIDER: "fake",
    SMS_PROVIDER: "console",
    OTP_DEV_CODE_IN_RESPONSE: "true",
    WEB_PUBLIC_URL: WEB_URL,
    API_PUBLIC_URL: API_URL,
    TAP_SECRET_KEY: "fake-secret",
    // the Odoo outbox timer runs here (production mode): it must never write to a real Odoo
    ODOO_WRITE_LOGIN: "",
    ODOO_WRITE_API_KEY: "",
  };
}
