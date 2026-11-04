import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cart } from "@/features/catalog/cart";
import { track } from "@/lib/track";
import { CUSTOMER_NAME_MAX } from "@/shared/validation";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError, branchOrder, CART_KEY, CART_PRODUCTS, ORDER_ID, ORDER_KEY, webOrder } from "@/tests/shop-fixtures";
import type { ContactDetails } from "./checkout-state";
import { DetailsStep, type DetailsStepProps } from "./details-step";
import { loadTapSdk, TAP_SDK_URL } from "./tap-sdk";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));
// the real loader, watched: a build without card payment must never ask for Tap's script
vi.mock("./tap-sdk", async (actual) => {
  const real = await actual<typeof import("./tap-sdk")>();
  return { ...real, loadTapSdk: vi.fn(real.loadTapSdk) };
});

interface Sent {
  body: unknown;
  key: string | null;
  csrf: string | null;
}

const SARA: ContactDetails = { name: "Sara Ali", phone: "55123456", email: "sara@example.com" };
const EMPTY: ContactDetails = { name: "", phone: "", email: "" };

function props(over: Partial<DetailsStepProps> = {}): DetailsStepProps {
  return { contact: SARA, signedIn: false, cardEnabled: true, onCreated: vi.fn(), ...over };
}

function listenForOrders(answer: () => Response = () => HttpResponse.json({ ...webOrder(), replayed: false, key: ORDER_KEY }, { status: 201 })) {
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
  it("is filled in from what is known and shows the basket", () => {
    renderOnSite(<DetailsStep {...props()} />);
    expect(screen.getByLabelText("Full name")).toHaveValue("Sara Ali");
    expect(screen.getByLabelText("Mobile number")).toHaveValue("55123456");
    expect(screen.getByLabelText("Email")).toHaveValue("sara@example.com");
    // nothing is sent to the phone: it is for the branch to call
    expect(screen.getByText("So the branch can call you about your order.")).toBeInTheDocument();
    expect(screen.getByText("4K Dash Cam (Front & Rear)")).toBeInTheDocument();
    expect(screen.getByText("3D Floor Mats")).toBeInTheDocument();
  });

  it("starts empty for a guest", () => {
    renderOnSite(<DetailsStep {...props({ contact: EMPTY })} />);
    expect(screen.getByLabelText("Full name")).toHaveValue("");
    expect(screen.getByLabelText("Mobile number")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("refuses a number that is not a Qatari mobile, without asking the API", async () => {
    const sent = listenForOrders();
    const { user } = renderOnSite(<DetailsStep {...props({ contact: { ...SARA, phone: "" } })} />);
    await user.type(screen.getByLabelText("Mobile number"), "44123456");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("Enter a Qatari mobile number (8 digits starting with 3, 5, 6 or 7).")).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("keeps a signed-in customer's email as their account's", () => {
    renderOnSite(<DetailsStep {...props({ signedIn: true })} />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.getByText("The email of your account. Your receipt and order updates go here.")).toBeInTheDocument();
  });

  it("refuses a name that is too short and an email that is not one, without asking the API", async () => {
    const sent = listenForOrders();
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep {...props({ contact: { ...EMPTY, phone: "55123456" }, onCreated })} />);

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
    const { user } = renderOnSite(<DetailsStep {...props({ contact: { ...EMPTY, phone: "55123456" }, onCreated })} />);
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
    const { user } = renderOnSite(<DetailsStep {...props({ contact: { ...SARA, name: "S".repeat(CUSTOMER_NAME_MAX + 1) }, onCreated })} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => expect(screen.getByLabelText("Full name")).toHaveAttribute("aria-invalid", "true"));
    expect(sent).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates a card order from the basket with the contact details, the language and a fresh Idempotency-Key", async () => {
    const sent = listenForOrders();
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep {...props({ onCreated })} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: ORDER_ID, total: "619.50", key: ORDER_KEY })));
    expect(sent).toHaveLength(1);
    // only ids and quantities: the server prices the order, never the browser
    expect(sent[0].body).toEqual({
      items: [
        { productId: "p-cam", quantity: 2 },
        { productId: "p-mats", quantity: 1 },
      ],
      name: "Sara Ali",
      phone: "+97455123456",
      email: "sara@example.com",
      paymentMethod: "card",
      locale: "en",
    });
    expect(sent[0].key).toMatch(/^[0-9a-f-]{32,36}$/i);
    expect(sent[0].csrf).toBe("wolfcar");
    expect(vi.mocked(track).mock.calls.map((c) => c[0])).toContain("checkout_start");
  });

  it("sends what the customer typed instead of the remembered details", async () => {
    const sent = listenForOrders();
    const { user } = renderOnSite(<DetailsStep {...props()} />);
    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Sara Al-Kuwari");
    await user.clear(screen.getByLabelText("Mobile number"));
    await user.type(screen.getByLabelText("Mobile number"), "٦٦١٢٣٤٥٦");
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "Sara.K@Example.qa");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ name: "Sara Al-Kuwari", phone: "+97466123456", email: "sara.k@example.qa" });
  });

  it("orders to pay at the branch when the customer chooses so: the button says Place order", async () => {
    const sent = listenForOrders(() => HttpResponse.json({ ...branchOrder(), replayed: false, key: ORDER_KEY }, { status: 201 }));
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep {...props({ onCreated })} />, { locale: "ar" });
    expect(screen.getByRole("radio", { name: /ادفع الآن بالبطاقة/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /ادفع في المعرض عند الاستلام/ }));
    await user.click(screen.getByRole("button", { name: "أكّد الطلب" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: "branch", key: ORDER_KEY })));
    expect(sent[0].body).toMatchObject({ paymentMethod: "branch", locale: "ar" });
  });

  it("without card payment, orders to pay at the branch only, and never loads Tap", async () => {
    const sent = listenForOrders(() => HttpResponse.json({ ...branchOrder(), replayed: false, key: ORDER_KEY }, { status: 201 }));
    vi.mocked(loadTapSdk).mockClear();
    const { user } = renderOnSite(<DetailsStep {...props({ cardEnabled: false })} />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("Pay at the branch when you collect")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ paymentMethod: "branch" });
    expect(loadTapSdk).not.toHaveBeenCalled();
  });

  it("says so when the customer already has orders waiting at the branch", async () => {
    listenForOrders(() => apiError(409, "TOO_MANY_OPEN_ORDERS"));
    const { user } = renderOnSite(<DetailsStep {...props({ cardEnabled: false })} />);
    await user.click(screen.getByRole("button", { name: "Place order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You already have orders waiting at the branch. We'll call you to confirm them. If you didn't place them, call the branch, or sign in to order.");
  });

  it("removes products that became unavailable from the basket and says so", async () => {
    const sent = listenForOrders(() =>
      apiError(400, "PRODUCT_UNAVAILABLE", { message: "Some products are no longer available.", productIds: ["p-mats"] }),
    );
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep {...props({ onCreated })} />);
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
    const { user } = renderOnSite(<DetailsStep {...props({ onCreated })} />);
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
    renderOnSite(<DetailsStep {...props()} />);
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
    renderOnSite(<DetailsStep {...props()} />);
    await waitFor(() => expect(document.querySelector(`script[src="${TAP_SDK_URL}"]`)).not.toBeNull());
  });

  it("reads a product name in its own script's direction", () => {
    act(() => cart.add({ id: "p-grille", name: "G700 جيتور - شبك امامي", price: null, thumbUrl: "/api/uploads/g-sm.webp" }));
    renderOnSite(<DetailsStep {...props()} />, { locale: "ar" });
    expect(screen.getByText("G700 جيتور - شبك امامي").closest("bdi")).toHaveAttribute("dir", "rtl");
  });

  it("says it in Arabic on the Arabic site", () => {
    renderOnSite(<DetailsStep {...props()} />, { locale: "ar" });
    expect(screen.getByText("غير مشمولة — اطلبها عبر واتساب")).toBeInTheDocument();
  });

  it("sends only the priced lines, and keeps the unpriced ones in the basket", async () => {
    const sent = listenForOrders();
    const onCreated = vi.fn();
    const { user } = renderOnSite(<DetailsStep {...props({ onCreated })} />);
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
    const { user } = renderOnSite(<DetailsStep {...props()} />);
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
    renderOnSite(<DetailsStep {...props()} />);
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeDisabled();
    expect(sent).toEqual([]);
  });
});
