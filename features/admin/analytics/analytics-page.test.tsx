import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsSummary, AnalyticsTotals } from "@/lib/api/types";
import { server } from "@/tests/msw";
import { makeUser, renderWithApp } from "@/tests/render";
import { resetAdminTestState } from "../shared/test-utils";
import { AnalyticsPage, chartColumns, rangeDays } from "./analytics-page";

const totals = (overrides: Partial<AnalyticsTotals> = {}): AnalyticsTotals => ({
  visitors: 0,
  visits: 0,
  pageviews: 0,
  whatsappOrder: 0,
  whatsappBooking: 0,
  whatsappChat: 0,
  calls: 0,
  addToCart: 0,
  visitorsAdded: 0,
  visitorsOrdered: 0,
  visitorsContacted: 0,
  wolfos: 0,
  ...overrides,
});

const SUMMARY: AnalyticsSummary = {
  from: "2026-09-10",
  to: "2026-10-09",
  totals: totals({ visitors: 200, visits: 240, pageviews: 900, whatsappOrder: 12, whatsappBooking: 5, whatsappChat: 20, calls: 3, addToCart: 60, visitorsAdded: 40, visitorsOrdered: 10, wolfos: 14 }),
  previous: totals({ visitors: 100, pageviews: 900, whatsappOrder: 24, wolfos: 7 }),
  daily: [
    { day: "2026-10-08", visitors: 80, pageviews: 300, contacts: 10 },
    { day: "2026-10-09", visitors: 120, pageviews: 600, contacts: 30 },
  ],
  pages: [
    { path: "/", views: 500, visitors: 180 },
    { path: "/products", views: 300, visitors: 90 },
    { path: "/something-new", views: 100, visitors: 30 },
  ],
  sources: [
    { source: "instagram", visits: 140 },
    { source: "direct", visits: 100 },
  ],
  devices: [{ device: "mobile", visitors: 170 }],
  locales: [{ locale: "ar", visitors: 150 }],
  products: [{ id: "p1", name: "Floor Mats", count: 22 }],
  models: [],
};

const admin = makeUser({ role: "SUPER_ADMIN", branch: null, permissions: ["analytics.read"] });

function mockSummary(body: AnalyticsSummary = SUMMARY) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get("/api/analytics/summary", ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json(body);
    }),
  );
  return queries;
}

const card = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;

beforeEach(() => resetAdminTestState("/en/dashboard/analytics"));

describe("website visitors page", () => {
  it("is closed to anyone without the permission, and asks the API for nothing", () => {
    const queries = mockSummary();
    renderWithApp(<AnalyticsPage />, { user: makeUser({ role: "FINANCE", branch: null, permissions: ["product.read"] }) });
    expect(screen.getByRole("alert")).toHaveTextContent("View website visitor statistics");
    expect(queries).toHaveLength(0);
  });

  it("shows the last 30 days by default, with each headline number against the days before", async () => {
    const queries = mockSummary();
    renderWithApp(<AnalyticsPage />, { user: admin });

    // the same word heads a column of the daily table further down
    const visitors = (await screen.findAllByText("Visitors"))[0].parentElement as HTMLElement;
    expect(Object.fromEntries(queries[0])).toEqual(rangeDays(30));
    expect(visitors).toHaveTextContent("200");
    expect(visitors).toHaveTextContent("100% more than the 30 days before");
    expect(screen.getAllByText("Page views")[0].parentElement).toHaveTextContent("Same as the 30 days before");
    expect(screen.getByText("Orders sent on WhatsApp").parentElement).toHaveTextContent("50% fewer than the 30 days before");
    // WhatsApp order + booking + other WhatsApp + calls
    expect(screen.getByText("WhatsApp and call presses").parentElement).toHaveTextContent("40");
    expect(screen.getByText("Added to basket").parentElement).toHaveTextContent("Nothing in the 30 days before");
    // presses on "Our app" and the WolfOS section, not counted as contacts
    const wolfos = screen.getByText("WolfOS presses").parentElement as HTMLElement;
    expect(wolfos).toHaveTextContent("14");
    expect(wolfos).toHaveTextContent("100% more than the 30 days before");
  });

  it("breaks the visits down by step, button, source, page, product and device", async () => {
    mockSummary();
    renderWithApp(<AnalyticsPage />, { user: admin });

    const funnel = within(await screen.findByRole("heading", { name: "From visit to order" }).then((h) => h.closest("section") as HTMLElement));
    expect(funnel.getByText("Added something to the basket").parentElement).toHaveTextContent("20% of visitors");
    expect(funnel.getByText("Sent the basket on WhatsApp").parentElement).toHaveTextContent("5% of visitors");

    expect(within(card("Contact buttons pressed")).getByText("Booking form on WhatsApp").parentElement).toHaveTextContent("5 times");
    expect(within(card("Where visits came from")).getByText("Instagram").parentElement).toHaveTextContent("140 visits");
    const pages = within(card("Most viewed pages"));
    expect(pages.getByText("Home page").parentElement).toHaveTextContent("500 views");
    expect(pages.getByText("Parts & accessories")).toBeInTheDocument();
    // a page without a friendly name shows its address
    expect(pages.getByText("/something-new")).toBeInTheDocument();
    expect(within(card("Most added to basket")).getByText("Floor Mats").parentElement).toHaveTextContent("22 times");
    expect(within(card("Most opened car models")).getByText("Nothing yet")).toBeInTheDocument();
    expect(within(card("Devices")).getByText("Phone").parentElement).toHaveTextContent("170 visitors");
    expect(within(card("Language")).getByText("Arabic")).toBeInTheDocument();
  });

  it("offers the daily numbers as a table and on hover", async () => {
    mockSummary();
    const { user } = renderWithApp(<AnalyticsPage />, { user: admin });

    const table = await screen.findByRole("table", { name: "Visitors per day" });
    expect(within(table).getByRole("row", { name: /Oct 9, 2026/ })).toHaveTextContent("120600" + "30");
    const columns = within(card("Visitors per day")).getAllByRole("button", { hidden: true });
    await user.hover(columns[0]);
    expect(card("Visitors per day")).toHaveTextContent("Oct 8, 2026: 80 visitors, 300 page views, 10 contact presses");
  });

  it("switches the period and keeps it in the address", async () => {
    const queries = mockSummary();
    const { user } = renderWithApp(<AnalyticsPage />, { user: admin });

    await user.click(await screen.findByRole("button", { name: "7 days" }));
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
    expect(window.location.search).toBe("?range=7");
    await screen.findAllByText("Visitors");
    expect(Object.fromEntries(queries.at(-1)!)).toEqual(rangeDays(7));
  });

  it("says so when nothing was recorded", async () => {
    mockSummary({ ...SUMMARY, totals: totals(), previous: totals(), daily: [], pages: [], sources: [], devices: [], locales: [], products: [] });
    renderWithApp(<AnalyticsPage />, { user: admin });
    expect(await screen.findByText("No visits recorded in this period yet")).toBeInTheDocument();
  });
});

describe("daily chart columns", () => {
  const days = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), visitors: i < 7 ? 10 : 0, pageviews: 2, contacts: 1 }));

  it("keeps one column per day up to 90 days", () => {
    const columns = chartColumns(days(90));
    expect(columns).toHaveLength(90);
    expect(columns[0]).toEqual({ from: "2026-01-01", to: "2026-01-01", visitors: 10, pageviews: 2, contacts: 1 });
  });

  it("draws a year as weeks: the average day's visitors, the week's page views and contacts", () => {
    const columns = chartColumns(days(365));
    expect(columns).toHaveLength(53);
    expect(columns[0]).toEqual({ from: "2026-01-01", to: "2026-01-07", visitors: 10, pageviews: 14, contacts: 7 });
    expect(columns[1].visitors).toBe(0);
    // the last week of a year is a single day
    expect(columns[52]).toMatchObject({ from: "2026-12-31", to: "2026-12-31" });
  });
});
