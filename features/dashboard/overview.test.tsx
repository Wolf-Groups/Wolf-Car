import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import arApp from "@/messages/app/ar";
import enApp from "@/messages/app/en";
import { ROLES } from "@/shared/permissions";
import { server } from "@/tests/msw";
import { makeUser, renderWithApp } from "@/tests/render";
import { Overview } from "./overview";

describe("Overview", () => {
  it("has a subtitle for every role, in both languages", () => {
    for (const messages of [enApp, arApp]) {
      expect(Object.keys(messages.Dashboard.subtitle).sort()).toEqual([...ROLES].sort());
    }
  });

  it("counts showroom orders as pending (a web order waiting for its card is not the cashier's to act on)", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get("/api/orders", ({ request }) => {
        const q = new URL(request.url).searchParams;
        queries.push(q);
        const total = q.get("status") === "PENDING" ? 4 : q.get("status") === "CONFIRMED" ? 2 : 7;
        return HttpResponse.json({ items: [], page: 1, pageSize: Number(q.get("pageSize")), total });
      }),
    );
    const cashier = makeUser({ role: "CASHIER", displayName: "Bo", permissions: ["order.read.branch"] });
    renderWithApp(<Overview />, { user: cashier });

    const pending = await screen.findByRole("link", { name: /Pending orders/ });
    await waitFor(() => expect(pending).toHaveTextContent("4"));
    // the stat opens the same list it counted
    expect(pending).toHaveAttribute("href", "/dashboard/orders?status=PENDING&source=SHOWROOM");
    const pendingQuery = queries.find((q) => q.get("status") === "PENDING");
    expect(pendingQuery?.get("source")).toBe("SHOWROOM");
    // "Orders today" asks the default list, which leaves abandoned checkouts out on the server
    const today = queries.find((q) => q.get("from") && !q.get("status"));
    expect(today?.get("source")).toBeNull();
    await waitFor(() => expect(screen.getByRole("link", { name: /Orders today/ })).toHaveTextContent("7"));
  });

  it("greets the call center and shows the requests waiting for her", async () => {
    server.use(http.get("/api/ppf/requests", () => HttpResponse.json({ items: [], page: 1, pageSize: 1, total: 3 })));
    const amani = makeUser({ role: "RESERVATIONS", displayName: "Amani", branch: null, permissions: ["booking.ppf.read", "booking.ppf.manage", "booking.general.manage"] });
    renderWithApp(<Overview />, { user: amani });
    expect(screen.getByText("PPF bookings and general reservations.")).toBeInTheDocument();
    const stat = await screen.findByRole("link", { name: /Requests waiting/ });
    expect(stat).toHaveAttribute("href", "/dashboard/ppf-bookings");
    await waitFor(() => expect(stat).toHaveTextContent("3"));
  });
});
