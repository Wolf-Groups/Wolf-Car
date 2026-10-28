import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cart } from "@/features/catalog/cart";
import { track } from "@/lib/track";
import { CUSTOMER_NAME_MAX } from "@/shared/validation";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError, CART_KEY, CART_PRODUCTS, customer, ORDER_ID, webOrder } from "@/tests/shop-fixtures";
import { DetailsStep } from "./details-step";
import { TAP_SDK_URL } from "./tap-sdk";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

interface Sent {
  body: unknown;
  key: string | null;
  csrf: string | null;
}

function listenForOrders(answer: () => Response = () => HttpResponse.json({ ...webOrder(), replayed: false }, { status: 201 })) {
  const sent: Sent[] = [];
  server.use(
    http.post("/api/shop/orders", async ({ request }) => {
      sent.push({ body: await request.json(), key: request.headers.get("idempotency-key"), csrf: request.headers.get("x-requested-with") });
      return answer();
    }),
  );
  return sent;
}

const storedCart = () => JSON.parse(localStorage.getItem(CART_KEY) ?? "[]") as { id: string; qty: number }[];

beforeEach(() => {
  act(() => {
    cart.clear();
    cart.add(CART_PRODUCTS[0]);
    cart.add(CART_PRODUCTS[0]);
    cart.add(CART_PRODUCTS[1]);
  });
});
afterEach(() => act(() => cart.clear()));

describe("checkout: details step", () => {
  it("is filled in from the customer and shows the basket", () => {
    renderOnSite(<DetailsStep customer={customer()} onCreated={vi.fn()} />);
    expect(screen.getByLabelText("Full name")).toHaveValue("Sara Ali");
    expect(screen.getByLabelText("Email")).toHaveValue("sara@example.com");
    expect(screen.getByText("4K Dash Cam (Front & Rear)")).toBeInTheDocument();
    expect(screen.getByText("3D Floor Mats")).toBeInTheDocument();
  });

  it("starts empty for a customer the shop has not met", () => {
    renderOnSite(<DetailsStep customer={customer({ name: null, email: null })} onCreated={vi.fn()} />);
    expect(screen.getByLabelText("Full name")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("refuses a name that is too short and an email that is not one, without asking the API", async () => {
    const sent = listenForOrders();
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep customer={customer({ name: null, email: null })} onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Full name"), "S");
    await user.type(screen.getByLabelText("Email"), "sara@");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => expect(screen.getByLabelText("Full name")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");

    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Sara Ali");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(screen.getByLabelText("Full name")).not.toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");

    expect(sent).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it.each([
    ["Sara 2", "sara@example.com", "Full name"],
    ["Sara Ali", "sara@example.c", "Email"],
  ])("refuses %s / %s without asking the API", async (name, email, field) => {
    const sent = listenForOrders();
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep customer={customer({ name: null, email: null })} onCreated={onCreated} />);
    await user.type(screen.getByLabelText("Full name"), name);
    await user.type(screen.getByLabelText("Email"), email);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => expect(screen.getByLabelText(field)).toHaveAttribute("aria-invalid", "true"));
    expect(sent).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("refuses a name longer than CUSTOMER_NAME_MAX without asking the API", async () => {
    // prefilled, not typed: a maxLength attribute on the input would stop user.type at the limit
    const sent = listenForOrders();
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep customer={customer({ name: "S".repeat(CUSTOMER_NAME_MAX + 1) })} onCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => expect(screen.getByLabelText("Full name")).toHaveAttribute("aria-invalid", "true"));
    expect(sent).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates the order from the basket with the name, email and a fresh Idempotency-Key", async () => {
    const sent = listenForOrders();
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep customer={customer()} onCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: ORDER_ID, total: "619.50" })));
    expect(sent).toHaveLength(1);
    // only ids and quantities: the server prices the order, never the browser
    expect(sent[0].body).toEqual({
      items: [
        { productId: "p-cam", quantity: 2 },
        { productId: "p-mats", quantity: 1 },
      ],
      name: "Sara Ali",
      email: "sara@example.com",
    });
    expect(sent[0].key).toMatch(/^[0-9a-f-]{32,36}$/i);
    expect(sent[0].csrf).toBe("wolfcar");
    expect(vi.mocked(track).mock.calls.map((c) => c[0])).toContain("checkout_start");
  });

  it("sends what the customer typed instead of the remembered details", async () => {
    const sent = listenForOrders();
    const { user } = renderOnSite(<DetailsStep customer={customer()} onCreated={vi.fn()} />);
    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Sara Al-Kuwari");
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "sara.k@example.qa");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ name: "Sara Al-Kuwari", email: "sara.k@example.qa" });
  });

  it("removes products that became unavailable from the basket and says so", async () => {
    const sent = listenForOrders(() =>
      apiError(400, "PRODUCT_UNAVAILABLE", { message: "Some products are no longer available.", productIds: ["p-mats"] }),
    );
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep customer={customer()} onCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    expect(await screen.findByText("One item is no longer available and was removed from your cart.")).toBeInTheDocument();
    expect(sent).toHaveLength(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(storedCart().map((l) => l.id)).toEqual(["p-cam"]);
    await waitFor(() => expect(screen.queryByText("3D Floor Mats")).not.toBeInTheDocument());
    expect(screen.getByText("4K Dash Cam (Front & Rear)")).toBeInTheDocument();
  });

  it("shows any other refusal and keeps the basket", async () => {
    listenForOrders(() => apiError(503, "CHECKOUT_UNAVAILABLE"));
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep customer={customer()} onCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Online payment isn't available right now. Order on WhatsApp instead.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(storedCart().map((l) => l.id)).toEqual(["p-cam", "p-mats"]);
  });
});

describe("checkout: details step with lines that have no price", () => {
  const WRAP = { id: "p-wrap", name: "PPF Full Wrap", price: null, thumbUrl: "/api/uploads/wrap-sm.webp" };
  beforeEach(() => act(() => cart.add(WRAP)));

  it("totals the priced lines only and lists the unpriced ones as not included, for WhatsApp", () => {
    renderOnSite(<DetailsStep customer={customer()} onCreated={vi.fn()} />);
    expect(screen.getByText("Not included — order these on WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("PPF Full Wrap")).toBeInTheDocument();
    // 2 × 499.00 + 120.50, the wrap left out
    expect(screen.getByText(/1,118\.50/)).toBeInTheDocument();
    const whatsapp = screen.getByRole("link", { name: "Order on WhatsApp · Bin Omran" });
    const text = decodeURIComponent(whatsapp.getAttribute("href") ?? "");
    expect(text).toContain("PPF Full Wrap");
    expect(text).not.toContain("3D Floor Mats");
  });

  it("starts fetching Tap's card script while the customer types, for a faster pay step", async () => {
    renderOnSite(<DetailsStep customer={customer()} onCreated={vi.fn()} />);
    await waitFor(() => expect(document.querySelector(`script[src="${TAP_SDK_URL}"]`)).not.toBeNull());
  });

  it("reads a product name in its own script's direction", () => {
    act(() => cart.add({ id: "p-grille", name: "G700 جيتور - شبك امامي", price: null, thumbUrl: "/api/uploads/g-sm.webp" }));
    renderOnSite(<DetailsStep customer={customer()} onCreated={vi.fn()} />, { locale: "ar" });
    expect(screen.getByText("G700 جيتور - شبك امامي").closest("bdi")).toHaveAttribute("dir", "rtl");
  });

  it("says it in Arabic on the Arabic site", () => {
    renderOnSite(<DetailsStep customer={customer()} onCreated={vi.fn()} />, { locale: "ar" });
    expect(screen.getByText("غير مشمولة — اطلبها عبر واتساب")).toBeInTheDocument();
  });

  it("sends only the priced lines, and keeps the unpriced ones in the basket", async () => {
    const sent = listenForOrders();
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep customer={customer()} onCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(sent[0].body).toMatchObject({
      items: [
        { productId: "p-cam", quantity: 2 },
        { productId: "p-mats", quantity: 1 },
      ],
    });
    expect(storedCart().map((l) => l.id)).toEqual(["p-cam", "p-mats", "p-wrap"]);
  });

  it("removes only the products the API said are unavailable, never the unpriced ones", async () => {
    listenForOrders(() => apiError(400, "PRODUCT_UNAVAILABLE", { message: "Some products are no longer available.", productIds: ["p-mats"] }));
    const { user } = renderOnSite(<DetailsStep customer={customer()} onCreated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    expect(await screen.findByText("One item is no longer available and was removed from your cart.")).toBeInTheDocument();
    expect(storedCart().map((l) => l.id)).toEqual(["p-cam", "p-wrap"]);
  });

  it("cannot continue when no line has a price", async () => {
    act(() => {
      cart.setQty("p-cam", 0);
      cart.setQty("p-mats", 0);
    });
    const sent = listenForOrders();
    renderOnSite(<DetailsStep customer={customer()} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeDisabled();
    expect(sent).toEqual([]);
  });
});
