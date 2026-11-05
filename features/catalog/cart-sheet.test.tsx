import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderOnSite } from "@/tests/render-site";
import { cart } from "./cart";
import { CartSheet } from "./cart-sheet";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

const MATS = { id: "p-mats", name: "3D Floor Mats", price: "120.50", thumbUrl: "/api/uploads/mats-sm.webp" };
const WRAP = { id: "p-wrap", name: "PPF Full Wrap", price: null, thumbUrl: "/api/uploads/wrap-sm.webp" };

// the build carries Tap's public key unless a test says otherwise: card checkout is on
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_TAP_PUBLIC_KEY", "pk_test_wolfcar"));
afterEach(() => {
  act(() => cart.clear());
  vi.unstubAllEnvs();
});

async function openCart(locale: "ar" | "en" = "en", first: typeof MATS | typeof WRAP = MATS) {
  act(() => cart.add(first));
  const view = renderOnSite(<CartSheet />, { locale });
  await view.user.click(screen.getByRole("button", { name: locale === "ar" ? /عرض السلة/ : /View cart/ }));
  return { ...view, sheet: await screen.findByRole("dialog") };
}

describe("cart drawer", () => {
  it("offers Checkout first, to the checkout", async () => {
    const { sheet } = await openCart();
    expect(within(sheet).getByRole("link", { name: "Checkout" })).toHaveAttribute("href", "/checkout");
  });

  it("keeps the WhatsApp order as the second way, below Checkout", async () => {
    const { sheet } = await openCart();
    const checkout = within(sheet).getByRole("link", { name: "Checkout" });
    const whatsapp = within(sheet).getByRole("link", { name: "Order on WhatsApp · Bin Omran" });
    expect(whatsapp.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/97471008939\?text=/);
    expect(whatsapp).toHaveAttribute("data-track", "whatsapp_order");
    expect(checkout.compareDocumentPosition(whatsapp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sheet).getByText("or order on WhatsApp")).toBeInTheDocument();
  });

  it("offers no checkout once the basket is emptied", async () => {
    const { sheet, user } = await openCart();
    expect(within(sheet).getByRole("link", { name: "Checkout" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Empty cart" }));
    expect(within(sheet).getByText("Your cart is empty.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: "Checkout" })).not.toBeInTheDocument();
  });

  it("says Checkout in Arabic on the Arabic site", async () => {
    const { sheet } = await openCart("ar");
    expect(within(sheet).getByRole("link", { name: "إتمام الطلب" })).toHaveAttribute("href", "/checkout");
    expect(
      within(sheet).getByText("اطلب من هنا وادفع بالبطاقة أو في فرع بن عمران عند الاستلام، أو أرسل القائمة عبر واتساب ليؤكد الفريق التوفر والتوافق أولًا."),
    ).toBeInTheDocument();
  });

  it("says how each way works: order here (card or at the branch), or WhatsApp with the branch confirming first", async () => {
    const { sheet } = await openCart();
    expect(
      within(sheet).getByText("Order here and pay by card or at our Bin Omran branch when you collect, or send this list on WhatsApp and the team confirms stock and fit first."),
    ).toBeInTheDocument();
  });

  it("says unpriced items can only be ordered on WhatsApp, not in an online order", async () => {
    act(() => cart.add(WRAP));
    const { sheet } = await openCart();
    expect(within(sheet).getByText("1 item has no price yet. Items without a price can only be ordered on WhatsApp; an online order leaves them out.")).toBeInTheDocument();
  });

  it("says the same about unpriced items in Arabic", async () => {
    act(() => cart.add(WRAP));
    const { sheet } = await openCart("ar");
    expect(within(sheet).getByText("منتج واحد بلا سعر بعد. المنتجات غير المسعّرة تُطلب عبر واتساب فقط، ولا يشملها الطلب من الموقع.")).toBeInTheDocument();
  });
});

describe("cart drawer without card payment", () => {
  const whatsappOnly = "Send this list on WhatsApp to our Bin Omran branch and the team confirms stock and fit.";

  it("still offers Checkout when the build has no Tap public key, and never mentions cards", async () => {
    vi.stubEnv("NEXT_PUBLIC_TAP_PUBLIC_KEY", "");
    const { sheet } = await openCart();
    expect(within(sheet).getByRole("link", { name: "Checkout" })).toHaveAttribute("href", "/checkout");
    expect(within(sheet).getByText("Order here and pay at our Bin Omran branch when you collect, or send this list on WhatsApp and the team confirms stock and fit first.")).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/card/i);
  });

  it("offers no Checkout when no line has a price: WhatsApp only, as the main button", async () => {
    const { sheet } = await openCart("en", WRAP);
    expect(within(sheet).queryByRole("link", { name: "Checkout" })).not.toBeInTheDocument();
    expect(within(sheet).queryByText("or order on WhatsApp")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Order on WhatsApp · Bin Omran" })).toHaveClass("bg-wa");
    expect(within(sheet).getByText(whatsappOnly)).toBeInTheDocument();
  });

  it("says so in Arabic on the Arabic site", async () => {
    const { sheet } = await openCart("ar", WRAP);
    expect(within(sheet).getByText("أرسل القائمة عبر واتساب إلى فرع بن عمران ليؤكد الفريق التوفر والتوافق.")).toBeInTheDocument();
  });

  it("does not speak of online orders in the unpriced note when nothing can be ordered online", async () => {
    const { sheet } = await openCart("en", WRAP);
    expect(within(sheet).getByText("1 item has no price yet: the branch gives you its price on WhatsApp.")).toBeInTheDocument();
  });

  it("still offers Checkout when at least one line has a price", async () => {
    act(() => cart.add(WRAP));
    const { sheet } = await openCart();
    expect(within(sheet).getByRole("link", { name: "Checkout" })).toHaveAttribute("href", "/checkout");
  });
});
