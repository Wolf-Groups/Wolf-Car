import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/**
 * Shared MSW server; tests add handlers with server.use(http.get("/api/...", ...)).
 * The defaults: Odoo is not connected, so pages that show its sync status
 * stay as they were unless a test says otherwise, and the catalogue has no
 * categories, so the products page's car filter offers only "All".
 */
export const server = setupServer(
  http.get("/api/odoo/sync", () => HttpResponse.json({ configured: false, running: false, everyMinutes: 15, last: null, lastOk: null })),
  http.get("/api/public/categories", () => HttpResponse.json([])),
);
