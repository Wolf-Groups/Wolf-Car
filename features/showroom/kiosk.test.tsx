import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { setAccessToken } from "@/lib/api/client";
import type { OrderDetail, ShowroomCategory, ShowroomProduct } from "@/lib/api/types";
import { server } from "@/tests/msw";
import { makeUser, renderWithApp } from "@/tests/render";
import { router } from "@/tests/setup";
import { ShowroomKiosk, type ShowroomCatalog } from "./kiosk";
import { SUCCESS_RESET_MS } from "./success-overlay";
import { IDLE_TIMEOUT_MS } from "./use-idle-timeout";

const staff = makeUser({ permissions: ["order.create"] });

const BRAKES: ShowroomProduct = {
  id: "7c1f1f7e-0000-4000-8000-000000000001",
  name: "Brake pads",
  description: "Ceramic front pads",
  barcode: "BP-100",
  categoryId: "cat-1",
  price: "145.50",
  imageUrl: "/api/uploads/brakes.webp",
  thumbUrl: "/api/uploads/brakes-sm.webp",
};
const CLIP: ShowroomProduct = {
  id: "7c1f1f7e-0000-4000-8000-000000000002",
  name: "Trim clip",
  description: null,
  barcode: null,
  categoryId: "cat-2",
  price: "0.10",
  imageUrl: "/api/uploads/clip.webp",
  thumbUrl: "/api/uploads/clip-sm.webp",
};
const CATEGORIES: ShowroomCategory[] = [
  { id: "cat-1", name: "Leopard 5", carModel: "Leopard 5", imageUrl: null, thumbUrl: null, count: 1 },
  { id: "cat-2", name: "Tank 500", carModel: "Tank 500", imageUrl: null, thumbUrl: null, count: 1 },
];
const catalog = (products: ShowroomProduct[] = [BRAKES, CLIP], categories = CATEGORIES): ShowroomCatalog => ({
  branch: { id: "b-gh", code: "GH", name: "Al Gharrafa Branch", nameAr: "فرع الغرافة" },
  categories,
  products,
});

function orderFor(customerName: string): OrderDetail {
  return {
    id: "o-1",
    code: "GH-000042",
    number: 42,
    status: "PENDING",
    source: "SHOWROOM",
    paymentStatus: "NONE",
    paidAt: null,
    collectedAt: null,
    customerName,
    customerPhone: null,
    customerEmail: null,
    collectedBy: null,
    payment: null,
    odoo: null,
    total: "436.60",
    currency: "QAR",
    itemCount: 4,
    branch: catalog().branch,
    createdBy: { id: staff.id, username: staff.username, displayName: staff.displayName },
    confirmedBy: null,
    confirmedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: "2026-09-21T10:00:00.000Z",
    updatedAt: "2026-09-21T10:00:00.000Z",
    items: [],
  };
}

function renderKiosk() {
  return renderWithApp(
    <>
      <ShowroomKiosk />
      <Toaster />
    </>,
    { user: staff },
  );
}

const panel = () => screen.getByTestId("cart-panel");

beforeEach(() => {
  sessionStorage.clear();
  // two sessions in memory: showroom calls must use the showroom one
  setAccessToken("dashboard", "dashboard-token");
  setAccessToken("showroom", "showroom-token");
});

afterEach(() => {
  setAccessToken("dashboard", null);
  setAccessToken("showroom", null);
  vi.useRealTimers();
});

describe("showroom kiosk", () => {
  it("lists the branch's products using the showroom session", async () => {
    const auth: (string | null)[] = [];
    server.use(
      http.get("/api/showroom/products", ({ request }) => {
        auth.push(request.headers.get("authorization"));
        return HttpResponse.json(catalog());
      }),
    );
    renderKiosk();

    expect(await screen.findByRole("heading", { name: "Brake pads" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trim clip" })).toBeInTheDocument();
    expect(screen.getByText("Ceramic front pads")).toBeInTheDocument();
    // barcodes belong to the cashier, never the customer-facing kiosk
    expect(screen.queryByText("BP-100")).not.toBeInTheDocument();
    expect(screen.getByTestId("branch-name")).toHaveTextContent("Al Gharrafa Branch");
    expect(auth[0]).toBe("Bearer showroom-token");
    expect(within(panel()).getByText("Your cart is empty")).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Place order" })).toBeDisabled();
  });

  it("shows an out-of-stock product last, as not available, with no add button", async () => {
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog([{ ...BRAKES, available: false }, CLIP]))));
    renderKiosk();

    expect(await screen.findByRole("heading", { name: "Brake pads" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Trim clip", "Brake pads"]);
    const card = screen.getByRole("article", { name: "Brake pads" });
    expect(within(card).getByText("Not available")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
  });

  it("filters the grid by car model and keeps an All tab", async () => {
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog())));
    const { user } = renderKiosk();

    expect(await screen.findByRole("heading", { name: "Brake pads" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trim clip" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Leopard 5/ }));
    expect(screen.getByRole("heading", { name: "Brake pads" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Trim clip" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /All/ }));
    expect(screen.getByRole("heading", { name: "Trim clip" })).toBeInTheDocument();
  });

  it("searches the selected car, and offers every car when that one has no match", async () => {
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog())));
    const { user } = renderKiosk();
    await screen.findByRole("heading", { name: "Brake pads" });

    await user.type(screen.getByRole("searchbox", { name: "Search products" }), "ceramic");
    expect(await screen.findByText("1 product")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brake pads" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Trim clip" })).not.toBeInTheDocument();

    // the brake pads are a Leopard 5 product: nothing in Tank 500 matches
    await user.click(screen.getByRole("tab", { name: /Tank 500/ }));
    expect(screen.getByText("No products match.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Search all cars (1)" }));
    expect(screen.getByRole("heading", { name: "Brake pads" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("heading", { name: "Trim clip" })).toBeInTheDocument();
  });

  it("narrows by price band and sorts by price", async () => {
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog())));
    const { user } = renderKiosk();
    await screen.findByRole("heading", { name: "Brake pads" });
    const names = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names()).toEqual(["Brake pads", "Trim clip"]);

    await user.click(screen.getByRole("button", { name: "Lowest price" }));
    expect(names()).toEqual(["Trim clip", "Brake pads"]);

    await user.click(screen.getByRole("button", { name: "100 – 500" }));
    expect(names()).toEqual(["Brake pads"]);

    await user.click(screen.getByRole("button", { name: "Over 1,000" }));
    expect(screen.getByText("No products match.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(names()).toEqual(["Brake pads", "Trim clip"]);
  });

  it("shows a long catalogue a page at a time", async () => {
    const many = Array.from({ length: 30 }, (_, i): ShowroomProduct => ({ ...CLIP, id: `p-${i}`, name: `Clip ${i}` }));
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog(many))));
    const { user } = renderKiosk();

    await screen.findByRole("heading", { name: "Clip 0" });
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(24);
    await user.click(screen.getByRole("button", { name: "Show more (6)" }));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(30);
  });

  it("loads the next page by itself when the list is scrolled near its end", async () => {
    let seen: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof seen) {
          seen = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const many = Array.from({ length: 30 }, (_, i): ShowroomProduct => ({ ...CLIP, id: `p-${i}`, name: `Clip ${i}` }));
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog(many))));
    renderKiosk();

    await screen.findByRole("heading", { name: "Clip 0" });
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(24);
    act(() => seen([{ isIntersecting: true }]));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("offers packages and services in a tab of their own and orders them like a product", async () => {
    const services: ShowroomCatalog["services"] = {
      tiers: [{ id: "t1", set: "ppf", nameAr: "البكج الأول · Xpel", nameEn: "Package 1 · Xpel" }],
      services: [
        {
          id: "s-full",
          section: "ppfFull",
          nameAr: "الحماية الكاملة",
          nameEn: "Full Protection",
          noteAr: null,
          noteEn: "Includes a free CARONIC window tint",
          tierSet: "ppf",
          bodySplit: true,
          isActive: true,
          thumbUrl: "/api/uploads/tile-sm.webp",
          prices: [
            { productId: "7c1f1f7e-0000-4000-8000-0000000000a1", tierId: "t1", body: "sedan", price: "7999.00" },
            { productId: "7c1f1f7e-0000-4000-8000-0000000000a2", tierId: "t1", body: "suv", price: "8999.00" },
          ],
        },
      ],
    };
    server.use(http.get("/api/showroom/products", () => HttpResponse.json({ ...catalog(), services })));
    const { user } = renderKiosk();

    await user.click(await screen.findByRole("tab", { name: /Packages & services/ }));
    expect(screen.queryByRole("heading", { name: "Brake pads" })).not.toBeInTheDocument();
    // a complete package is a card of its own, under its poster
    expect(screen.getByRole("heading", { name: "Package 1 · Xpel" })).toBeInTheDocument();
    expect(screen.getByText("Full Protection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View the Package 1 · Xpel poster full size" })).toBeInTheDocument();
    expect(screen.getByText("Includes a free CARONIC window tint")).toBeInTheDocument();
    // most customers drive an SUV, so that price shows first
    expect(screen.getByText("QAR 8,999")).toBeInTheDocument();

    // the car type picks which price is shown and added
    await user.click(screen.getByRole("button", { name: "Sedan" }));
    expect(screen.getByText("QAR 7,999")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "SUV" }));
    expect(screen.getByText("QAR 8,999")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add Full Protection · Package 1 · Xpel" }));

    expect(within(panel()).getByText("Full Protection · Package 1 · Xpel · SUV")).toBeInTheDocument();
    expect(within(panel()).getByTestId("cart-total")).toHaveTextContent("QAR 8,999.00");
  });

  it("opens a product's photo large when it is pressed, without adding it", async () => {
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog())));
    const { user } = renderKiosk();

    await user.click(await screen.findByRole("button", { name: "View Brake pads larger" }));
    const dialog = screen.getByRole("dialog", { name: "Brake pads" });
    expect(within(dialog).getByRole("img", { name: "Brake pads" })).toHaveAttribute("src", BRAKES.imageUrl);
    expect(screen.queryByTestId("card-quantity")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a product common to a brand inside each of that brand's models", async () => {
    // filed under the brand; the API lists the brand's models in categoryIds
    const common: ShowroomProduct = { ...CLIP, categoryId: "brand", categoryIds: ["brand", "cat-1", "cat-2"] };
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog([BRAKES, common]))));
    const { user } = renderKiosk();

    await screen.findByRole("heading", { name: "Brake pads" });
    await user.click(screen.getByRole("tab", { name: /Leopard 5/ }));
    expect(screen.getByRole("heading", { name: "Trim clip" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Tank 500/ }));
    expect(screen.getByRole("heading", { name: "Trim clip" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brake pads" })).not.toBeInTheDocument();
  });

  it("offers the colours of one product on one card and adds the picked one", async () => {
    const colour = (n: number, label: string): ShowroomProduct => ({
      ...BRAKES,
      id: `7c1f1f7e-0000-4000-8000-00000000010${n}`,
      name: `Arm rest (${label})`,
      groupId: "2406",
      variantLabel: label,
      variantColor: "#060505",
    });
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog([colour(1, "Black"), colour(2, "Beige")]))));
    const { user } = renderKiosk();

    expect(await screen.findAllByRole("heading", { name: "Arm rest" })).toHaveLength(1);
    const picker = screen.getByRole("radiogroup", { name: "Colour" });
    expect(within(picker).getByRole("radio", { name: "Black" })).toBeChecked();
    await user.click(within(picker).getByRole("radio", { name: "Beige" }));
    await user.click(screen.getByRole("button", { name: "Add Arm rest (Beige)" }));
    expect(within(panel()).getByText("Arm rest (Beige)")).toBeInTheDocument();
    expect(within(panel()).queryByText("Arm rest (Black)")).not.toBeInTheDocument();
  });

  describe("at a branch whose cashier scans from the screen", () => {
    const scanCatalog = (): ShowroomCatalog => ({ ...catalog(), branch: { ...catalog().branch, scanFromScreen: true } });

    it("shows each product's barcode and opens it large for the scanner", async () => {
      server.use(http.get("/api/showroom/products", () => HttpResponse.json(scanCatalog())));
      const { user } = renderKiosk();

      await screen.findByRole("heading", { name: "Brake pads" });
      await user.click(screen.getByRole("button", { name: "Show the barcode of Brake pads" }));
      const dialog = await screen.findByRole("dialog", { name: "Brake pads" });
      expect(within(dialog).getByText("BP-100")).toBeInTheDocument();
      // a product without a barcode has nothing to scan
      expect(screen.queryByRole("button", { name: "Show the barcode of Trim clip" })).not.toBeInTheDocument();
    });

    it("keeps the basket closed until it is asked for, and lists the barcodes in it", async () => {
      server.use(http.get("/api/showroom/products", () => HttpResponse.json(scanCatalog())));
      const { user } = renderKiosk();

      await user.click(await screen.findByRole("button", { name: "Add Brake pads" }));
      expect(screen.queryByTestId("cart-panel")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /View cart/ }));
      expect(within(panel()).getByText("Brake pads")).toBeInTheDocument();
      expect(within(panel()).getByText("BP-100")).toBeInTheDocument();
    });
  });

  it("keeps a filtered-out product in the cart", async () => {
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog())));
    const { user } = renderKiosk();

    await screen.findByRole("heading", { name: "Brake pads" });
    await user.click(screen.getByRole("button", { name: "Add Brake pads" }));
    // switching to a tab that excludes it must not drop it from the cart
    await user.click(screen.getByRole("tab", { name: /Tank 500/ }));
    expect(within(panel()).getByText("Brake pads")).toBeInTheDocument();
  });

  it("adds products and adjusts quantities with exact totals", async () => {
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog())));
    const { user } = renderKiosk();

    const addBrakes = await screen.findByRole("button", { name: "Add Brake pads" });
    await user.click(addBrakes);
    await user.click(addBrakes);
    await user.click(addBrakes);
    await user.click(screen.getByRole("button", { name: "Add Trim clip" }));

    expect(within(panel()).getByText("4 items")).toBeInTheDocument();
    expect(screen.getByTestId("cart-total")).toHaveTextContent("QAR 436.60");
    expect(screen.getAllByTestId("card-quantity")[0]).toHaveTextContent("3 in cart");

    await user.click(within(panel()).getByRole("button", { name: "One more Brake pads" }));
    expect(screen.getByTestId("cart-total")).toHaveTextContent("QAR 582.10");
    await user.click(within(panel()).getByRole("button", { name: "One less Trim clip" }));
    await waitFor(() => expect(within(panel()).queryByRole("button", { name: "Remove Trim clip" })).not.toBeInTheDocument());
    expect(within(panel()).getByText("4 items")).toBeInTheDocument();
    expect(screen.getByTestId("cart-total")).toHaveTextContent("QAR 582.00");

    await user.click(within(panel()).getByRole("button", { name: "Remove Brake pads" }));
    expect(await within(panel()).findByText("Your cart is empty")).toBeInTheDocument();
  });

  it("validates the customer name, places the order idempotently and resets for the next customer", async () => {
    const requests: { body: unknown; key: string | null }[] = [];
    server.use(
      http.get("/api/showroom/products", () => HttpResponse.json(catalog())),
      http.post("/api/showroom/orders", async ({ request }) => {
        requests.push({ body: await request.json(), key: request.headers.get("idempotency-key") });
        // the first attempt fails (e.g. a network hiccup); the retry must reuse the key
        if (requests.length === 1) return HttpResponse.json({ statusCode: 503, message: "Unavailable" }, { status: 503 });
        return HttpResponse.json(orderFor("Sara Al-Kuwari"), { status: 201 });
      }),
    );
    const { user } = renderKiosk();

    const addBrakes = await screen.findByRole("button", { name: "Add Brake pads" });
    for (let i = 0; i < 3; i++) await user.click(addBrakes);
    await user.click(screen.getByRole("button", { name: "Add Trim clip" }));
    await user.click(within(panel()).getByRole("button", { name: "Place order" }));

    const dialog = await screen.findByRole("dialog", { name: "Almost done" });
    const name = within(dialog).getByLabelText("Customer name");
    expect(name).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Submit order" }));
    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();

    await user.type(name, "4ever");
    await user.click(within(dialog).getByRole("button", { name: "Submit order" }));
    expect(await within(dialog).findByText("Letters and spaces only.")).toBeInTheDocument();
    expect(requests).toHaveLength(0);

    await user.clear(name);
    await user.type(name, "  Sara   Al-Kuwari ");
    await user.click(within(dialog).getByRole("button", { name: "Submit order" }));
    expect(await screen.findByText("Something went wrong on our side. Please try again.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Submit order" }));

    const code = await screen.findByTestId("order-code");
    expect(code).toHaveTextContent("GH-000042");
    expect(code).toHaveAttribute("dir", "ltr");
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toEqual({
      items: [
        { productId: BRAKES.id, quantity: 3 },
        { productId: CLIP.id, quantity: 1 },
      ],
      customerName: "Sara Al-Kuwari",
      userId: staff.id,
    });
    expect(requests[0].key).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(requests[1].key).toBe(requests[0].key);

    await user.click(screen.getByRole("button", { name: "Next customer" }));
    await waitFor(() => expect(screen.queryByTestId("order-code")).not.toBeInTheDocument());
    expect(within(panel()).getByText("Your cart is empty")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // a new checkout gets a new key
    await user.click(screen.getByRole("button", { name: "Add Trim clip" }));
    await user.click(within(panel()).getByRole("button", { name: "Place order" }));
    await user.type(await screen.findByLabelText("Customer name"), "Omar");
    await user.click(screen.getByRole("button", { name: "Submit order" }));
    await screen.findByTestId("order-code");
    expect(requests[2].key).not.toBe(requests[0].key);
  });

  it("drops unavailable products and explains why when the order is rejected", async () => {
    let listed = catalog();
    server.use(
      http.get("/api/showroom/products", () => HttpResponse.json(listed)),
      http.post("/api/showroom/orders", () => {
        listed = catalog([BRAKES]);
        return HttpResponse.json(
          { statusCode: 400, message: "Some products are no longer available.", code: "PRODUCT_UNAVAILABLE", productIds: [CLIP.id] },
          { status: 400 },
        );
      }),
    );
    const { user } = renderKiosk();

    await user.click(await screen.findByRole("button", { name: "Add Brake pads" }));
    await user.click(screen.getByRole("button", { name: "Add Trim clip" }));
    await user.click(within(panel()).getByRole("button", { name: "Place order" }));
    await user.type(await screen.findByLabelText("Customer name"), "Sara");
    await user.click(screen.getByRole("button", { name: "Submit order" }));

    const dialog = screen.getByRole("dialog", { name: "Almost done" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Some products are no longer available. Please check the cart.");
    // the page behind the dialog is aria-hidden while it is open, so query by text
    await waitFor(() => expect(screen.queryByText("Trim clip")).not.toBeInTheDocument());
    expect(within(panel()).getByText("Brake pads")).toBeInTheDocument();
    expect(within(panel()).getAllByTestId("line-quantity")).toHaveLength(1);
    expect(screen.getByTestId("cart-total")).toHaveTextContent("QAR 145.50");
  });

  it("sends signed-out tablets to the showroom sign-in", () => {
    renderWithApp(<ShowroomKiosk />, { user: null });
    expect(router.replace).toHaveBeenCalledWith("/showroom/login");
  });
});

describe("showroom kiosk timers", () => {
  it("clears a non-empty cart after 3 minutes without activity", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog())));
    const { user } = renderKiosk();

    await user.click(await screen.findByRole("button", { name: "Add Brake pads" }));
    expect(within(panel()).getByText("1 item")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 10_000));
    // any touch restarts the countdown
    fireEvent.pointerDown(document.body);
    act(() => vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 10_000));
    expect(within(panel()).getByText("1 item")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(10_000));
    expect(within(panel()).getByText("Your cart is empty")).toBeInTheDocument();
    expect(await screen.findByText("The cart was cleared after a few minutes without activity.")).toBeInTheDocument();
  });

  it("forgets a visitor's search and car after 3 minutes without activity", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(http.get("/api/showroom/products", () => HttpResponse.json(catalog())));
    const { user } = renderKiosk();

    await screen.findByRole("heading", { name: "Brake pads" });
    await user.click(screen.getByRole("tab", { name: /Tank 500/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search products" }), "clip");
    expect(screen.queryByRole("heading", { name: "Brake pads" })).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(IDLE_TIMEOUT_MS));
    expect(await screen.findByRole("heading", { name: "Brake pads" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search products" })).toHaveValue("");
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true");
    // nothing was in the cart, so there is nothing to announce
    expect(screen.queryByText("The cart was cleared after a few minutes without activity.")).not.toBeInTheDocument();
    // the cards that came back are still animating in: let them finish on the
    // fake clock, or the frames they scheduled are lost with it and the next test's animations never run
    act(() => vi.advanceTimersByTime(1_000));
  });

  it("returns to the product grid on its own after an order", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(
      http.get("/api/showroom/products", () => HttpResponse.json(catalog())),
      http.post("/api/showroom/orders", () => HttpResponse.json(orderFor("Sara"), { status: 201 })),
    );
    const { user } = renderKiosk();

    await user.click(await screen.findByRole("button", { name: "Add Brake pads" }));
    await user.click(within(panel()).getByRole("button", { name: "Place order" }));
    await user.type(await screen.findByLabelText("Customer name"), "Sara");
    await user.click(screen.getByRole("button", { name: "Submit order" }));
    await screen.findByTestId("order-code");

    act(() => vi.advanceTimersByTime(SUCCESS_RESET_MS));
    await waitFor(() => expect(screen.queryByTestId("order-code")).not.toBeInTheDocument());
    expect(within(panel()).getByText("Your cart is empty")).toBeInTheDocument();
  });
});
