import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderOnSite } from "@/tests/render-site";
import { cart } from "./cart";
import { CartSheet } from "./cart-sheet";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

const MATS = { id: "p-mats", name: "3D Floor Mats", price: "120.50", thumbUrl: "/api/uploads/mats-sm.webp" };

afterEach(() => act(() => cart.clear()));

async function openCart(locale: "ar" | "en" = "en") {
  act(() => cart.add(MATS));
  const view = renderOnSite(<CartSheet />, { locale });
  await view.user.click(screen.getByRole("button", { name: locale === "ar" ? /عرض السلة/ : /View cart/ }));
  return { ...view, sheet: await screen.findByRole("dialog") };
}

describe("cart drawer", () => {
  it("offers Pay by card first, to the checkout", async () => {
    const { sheet } = await openCart();
    const pay = within(sheet).getByRole("link", { name: "Pay by card" });
    expect(pay).toHaveAttribute("href", "/checkout");
  });

  it("keeps the WhatsApp order as the second way, below Pay by card", async () => {
    const { sheet } = await openCart();
    const pay = within(sheet).getByRole("link", { name: "Pay by card" });
    const whatsapp = within(sheet).getByRole("link", { name: "Order on WhatsApp · Bin Omran" });
    expect(whatsapp.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/97471008939\?text=/);
    expect(whatsapp).toHaveAttribute("data-track", "whatsapp_order");
    expect(pay.compareDocumentPosition(whatsapp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sheet).getByText("or order on WhatsApp")).toBeInTheDocument();
  });

  it("offers no checkout once the basket is emptied", async () => {
    const { sheet, user } = await openCart();
    expect(within(sheet).getByRole("link", { name: "Pay by card" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Empty cart" }));
    expect(within(sheet).getByText("Your cart is empty.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: "Pay by card" })).not.toBeInTheDocument();
  });

  it("says Pay by card in Arabic on the Arabic site", async () => {
    const { sheet } = await openCart("ar");
    expect(within(sheet).getByRole("link", { name: "الدفع بالبطاقة" })).toHaveAttribute("href", "/checkout");
    expect(within(sheet).getByText("ادفع بالبطاقة الآن واستلم من فرع بن عمران، أو أرسل القائمة عبر واتساب ليؤكد الفريق التوفر والتوافق أولًا.")).toBeInTheDocument();
  });

  // with card payment the customer pays first: nobody confirms stock or fit before a card payment
  it("says how each way works: pay by card now, or WhatsApp with the branch confirming first", async () => {
    const { sheet } = await openCart();
    expect(
      within(sheet).getByText("Pay by card now and collect at our Bin Omran branch, or send this list on WhatsApp and the team confirms stock and fit first."),
    ).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/before you pay/);
  });

  it("says unpriced items can only be ordered on WhatsApp, not in a card payment", async () => {
    act(() => cart.add({ id: "p-wrap", name: "PPF Full Wrap", price: null, thumbUrl: "/api/uploads/wrap-sm.webp" }));
    const { sheet } = await openCart();
    expect(
      within(sheet).getByText("1 item has no price yet. Items without a price can only be ordered on WhatsApp; a card payment leaves them out."),
    ).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/will confirm it/);
  });

  it("says the same about unpriced items in Arabic", async () => {
    act(() => cart.add({ id: "p-wrap", name: "PPF Full Wrap", price: null, thumbUrl: "/api/uploads/wrap-sm.webp" }));
    const { sheet } = await openCart("ar");
    expect(
      within(sheet).getByText("منتج واحد بلا سعر بعد. المنتجات غير المسعّرة تُطلب عبر واتساب فقط، ولا يشملها الدفع بالبطاقة."),
    ).toBeInTheDocument();
  });
});
