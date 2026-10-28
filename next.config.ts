import { networkInterfaces } from "node:os";
import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/** Where the Next.js server reaches the NestJS API (rewrites + server-side fetches). */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Security headers for the staff and showroom pages (the landing page keeps its own behaviour). */
const APP_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/**
 * The online checkout and its return page: never framed (a payment form must not be
 * clickjacked; Tap's own card frames inside the page are unaffected) nor indexed. The
 * referrer keeps the browser default rather than APP_HEADERS' same-origin, so Tap's
 * card form, served from Tap's domain, still sees which site embeds it.
 */
const CHECKOUT_HEADERS = APP_HEADERS.map((h) => (h.key === "Referrer-Policy" ? { ...h, value: "strict-origin-when-cross-origin" } : h));

/** This machine's LAN IPv4 addresses, so phones and laptops on the same Wi-Fi can use the dev server. */
const LAN_HOSTS = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net?.family === "IPv4" && !net.internal)
  .map((net) => net!.address);

const nextConfig: NextConfig = {
  // Docker: .next/standalone holds server.js plus only the traced node_modules
  output: "standalone",
  // dev only: Next blocks HMR and dev assets for hostnames other than localhost
  allowedDevOrigins: LAN_HOSTS,
  // this app lives inside a non-git workspace folder; pin the root so Turbopack
  // does not walk up and pick a stray lockfile
  turbopack: { root: path.resolve(__dirname) },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      // TEMP: placeholder service photos on the landing page
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  // one origin for the browser: /api/* is proxied to the API, so its cookies are first-party
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [
      { source: "/:locale(ar|en)/login", headers: APP_HEADERS },
      { source: "/:locale(ar|en)/dashboard/:path*", headers: APP_HEADERS },
      { source: "/:locale(ar|en)/dashboard", headers: APP_HEADERS },
      { source: "/:locale(ar|en)/showroom/:path*", headers: APP_HEADERS },
      { source: "/:locale(ar|en)/showroom", headers: APP_HEADERS },
      { source: "/:locale(ar|en)/slots", headers: APP_HEADERS },
      { source: "/:locale(ar|en)/checkout", headers: CHECKOUT_HEADERS },
      { source: "/:locale(ar|en)/checkout/:path*", headers: CHECKOUT_HEADERS },
      // the customer's account and orders: private, never framed nor indexed
      { source: "/:locale(ar|en)/account", headers: APP_HEADERS },
      { source: "/:locale(ar|en)/account/:path*", headers: APP_HEADERS },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
