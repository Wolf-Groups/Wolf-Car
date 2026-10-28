import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { router } from "@/tests/setup";
import { apiError, ORDER_ID, removeCardSdk, stubCardSdk, webOrder } from "@/tests/shop-fixtures";
import { PayStep } from "./pay-step";
import { READY_TIMEOUT_MS, TOKENIZE_TIMEOUT_MS } from "./tap-card";
import { TAP_SDK_URL } from "./tap-sdk";

const THREE_DS = "https://acceptance.sandbox.tap.company/gosell/v2/payment/3ds?chg=chg_TS05";
/** the Pay button says the amount: "Pay QAR 619.50" / "ادفع 619.50 ر.ق." */
const PAY = /^Pay QAR\s619\.50$/;
const PAY_AR = /^ادفع .*619\.50/;
const CARD_INVALID = "Some card details are missing or incorrect. Check the card number, expiry date and security code, and type the cardholder name in English letters.";
const assign = vi.fn();

function listenForPay(answer: () => Response | Promise<Response>) {
  const sent: unknown[] = [];
  server.use(
    http.post(`/api/shop/orders/${ORDER_ID}/pay`, async ({ request }) => {
      sent.push(await request.json());
      return answer();
    }),
  );
  return sent;
}

beforeEach(() => {
  // jsdom cannot navigate; Tap's 3-D Secure page is reached through location.assign
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  removeCardSdk();
});

describe("checkout: pay step", () => {
  it("shows the server's total, where to collect, and Tap's card form", async () => {
    const { sdk } = stubCardSdk();
    renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    expect(screen.getAllByText(/QAR\s619\.50/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Collect from .*Bin Omran/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Card details" })).toBeInTheDocument();
    expect(screen.getByText(/Enter the card number, then the expiry date \(MM\/YY\), then the 3-digit security code/)).toBeInTheDocument();
    expect(screen.getByText("We accept Visa and Mastercard.")).toBeInTheDocument();
    expect(screen.getByText(/Secure payment through Tap; your card details never reach our servers/)).toBeInTheDocument();
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalledWith("tap-card-sdk", expect.objectContaining({ publicKey: "pk_test_wolfcar" })));
  });

  it("tokenizes the card, pays with the token and follows Tap to 3-D Secure", async () => {
    const { sdk } = stubCardSdk();
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);

    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    await waitFor(() => expect(assign).toHaveBeenCalledWith(THREE_DS));
    expect(sdk.tokenize).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ tokenId: "tok_fake_ok", locale: "en" }]);
  });

  it("pays in Arabic on the Arabic site", async () => {
    stubCardSdk();
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="ar" onBack={vi.fn()} />, { locale: "ar" });
    const pay = await screen.findByRole("button", { name: PAY_AR });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);
    await waitFor(() => expect(sent).toEqual([{ tokenId: "tok_fake_ok", locale: "ar" }]));
  });

  it("goes to the return page itself when Tap captured at once (no redirect)", async () => {
    stubCardSdk();
    listenForPay(() => HttpResponse.json({ redirectUrl: null, order: webOrder({ status: "CONFIRMED", paymentStatus: "PAID" }) }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/return?order=${ORDER_ID}`));
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps the step when the card is declined, so another card can be tried", async () => {
    stubCardSdk();
    const sent = listenForPay(() => apiError(402, "PAYMENT_FAILED", { reason: "INVALID_TOKEN" }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    // Tap empties its form once it has issued the token: the card has to be typed again
    expect(await screen.findByRole("alert")).toHaveTextContent("The payment with this card didn't go through. Enter the card details again or try another card.");
    expect(assign).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: PAY })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: PAY }));
    await waitFor(() => expect(sent).toHaveLength(2));
  });

  it("says the order expired and offers the way back to the details", async () => {
    stubCardSdk();
    listenForPay(() => apiError(409, "ORDER_NOT_PAYABLE"));
    const onBack = vi.fn();
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={onBack} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    expect(await screen.findByText("This order timed out before it was paid. Go back to your details and confirm it again.")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    // the only way on, under keyboard and screen-reader focus
    expect(screen.getByRole("button", { name: "Back to your details" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Back to your details" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows Processing… and sends one payment however often Pay is pressed", async () => {
    // the API refuses a second pay only once a charge is CAPTURED, so a double click would make two Tap charges
    stubCardSdk();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sent = listenForPay(async () => {
      await gate;
      return HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() });
    });
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    const busy = await screen.findByRole("button", { name: "Processing…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    release();

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(1);
  });

  it("shows the result page of an order that is already paid", async () => {
    stubCardSdk();
    listenForPay(() => apiError(409, "ALREADY_PAID"));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/checkout/return?order=${ORDER_ID}`));
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks the API nothing when Tap could not read the card", async () => {
    stubCardSdk({ fail: "Card number is invalid" });
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    await waitFor(() => expect(screen.getByRole("button", { name: PAY })).toBeEnabled());
    expect(sent).toEqual([]);
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks to check the card when Tap marks it invalid during Pay, and lets the customer press Pay again", async () => {
    const { sdk, call } = stubCardSdk();
    // Tap only marks the wrong field: neither onSuccess nor onError
    vi.mocked(sdk.tokenize).mockImplementationOnce(() => undefined);
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);
    expect(await screen.findByRole("button", { name: "Processing…" })).toBeDisabled();

    call("onInvalidInput");
    expect(await screen.findByRole("alert")).toHaveTextContent(CARD_INVALID);
    await waitFor(() => expect(screen.getByRole("button", { name: PAY })).toBeEnabled());
    expect(sent).toEqual([]);

    // corrected card: Pay works again
    call("onValidInput");
    await user.click(screen.getByRole("button", { name: PAY }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(THREE_DS));
    expect(sent).toEqual([{ tokenId: "tok_fake_ok", locale: "en" }]);
  });

  it("takes the card message away once the card is corrected", async () => {
    const { call } = stubCardSdk();
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());

    call("onValidInput", false);
    call("onInvalidInput", true);
    await user.click(pay);
    expect(await screen.findByRole("alert")).toHaveTextContent(CARD_INVALID);

    call("onValidInput", true);
    call("onInvalidInput", false);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("pre-fills the name on the card from the order, only when it is written in English letters", async () => {
    const { state } = stubCardSdk();
    const view = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    await waitFor(() => expect(state.config).toMatchObject({ customer: { nameOnCard: "Sara Ali", editable: true } }));
    view.unmount();

    // Tap's field drops Arabic letters: the customer types the name as printed on the card instead
    const arabic = stubCardSdk();
    renderOnSite(<PayStep order={webOrder({ customer: { name: "سارة علي", email: null, phone: "+97455123456" } })} publicKey="pk_test_wolfcar" locale="ar" onBack={vi.fn()} />, {
      locale: "ar",
    });
    await waitFor(() => expect(arabic.state.config).not.toBeNull());
    expect(arabic.state.config).not.toHaveProperty("customer");
  });

  it("names Tap's card frame in the page's language", async () => {
    stubCardSdk();
    const { container } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="ar" onBack={vi.fn()} />, { locale: "ar" });
    await waitFor(() => expect(container.querySelector("#tap-card-iframe")).toHaveAttribute("title", "نموذج بيانات البطاقة الآمن من Tap"));
  });

  it("says the card form is loading, and keeps Pay off until it is ready", async () => {
    const { sdk, state, unmount, call } = stubCardSdk();
    vi.mocked(sdk.renderTapCard).mockImplementationOnce((_id, config) => {
      state.config = config;
      return { unmount };
    });
    renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Loading the secure card form…");
    expect(screen.getByRole("button", { name: PAY })).toBeDisabled();

    await waitFor(() => expect(state.config).not.toBeNull());
    act(() => call("onReady"));
    await waitFor(() => expect(screen.getByRole("button", { name: PAY })).toBeEnabled());
    expect(screen.queryByText("Loading the secure card form…")).not.toBeInTheDocument();
  });

  it("offers to reload the card form, or to order on WhatsApp, when Tap's script cannot load", async () => {
    removeCardSdk();
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const script = await waitFor(() => {
      const found = document.querySelector<HTMLScriptElement>(`script[src="${TAP_SDK_URL}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    script.dispatchEvent(new Event("error"));

    expect(await screen.findByRole("alert")).toHaveTextContent("The card form couldn't load. Check your connection and try again, or order on WhatsApp.");
    expect(screen.getByRole("link", { name: /Order on WhatsApp/ })).toHaveAttribute("href", expect.stringContaining("wa.me"));
    expect(screen.getByRole("button", { name: PAY })).toBeDisabled();

    // back online: the form loads again in place, without leaving the page
    const { sdk } = stubCardSdk();
    await user.click(screen.getByRole("button", { name: "Reload the card form" }));
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: PAY })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets the customer empty the card form and type the card again", async () => {
    const { sdk, call } = stubCardSdk();
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    call("onValidInput", true);
    call("onInvalidInput", false);

    await user.click(screen.getByRole("button", { name: "Clear card details and re-enter" }));
    expect(sdk.resetCardInputs).toHaveBeenCalledTimes(1);
    expect(sdk.renderTapCard).toHaveBeenCalledTimes(1);
    // the emptied form is not paid with: Pay asks for the card
    await user.click(pay);
    expect(await screen.findByRole("alert")).toHaveTextContent(CARD_INVALID);
    expect(sdk.tokenize).not.toHaveBeenCalled();
  });

  it("covers Tap's emptied form with the card being paid until the bank's page opens", async () => {
    stubCardSdk();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    listenForPay(async () => {
      await gate;
      return HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() });
    });
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    const covering = await screen.findByText(/Confirming your payment/);
    expect(covering.closest("[role=status]")).toHaveTextContent("VISA •••• 0010");
    release();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(THREE_DS));
  });

  it("asks to type the card again when the payment fails after Tap took the card", async () => {
    stubCardSdk();
    listenForPay(() => apiError(500, "INTERNAL"));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    expect(await screen.findByRole("alert")).toHaveTextContent("The payment didn't go through. Enter your card details again, then press Pay.");
    expect(screen.getByRole("button", { name: PAY })).toHaveAttribute("aria-describedby", "checkout-pay-error");
    expect(screen.queryByText(/Confirming your payment/)).not.toBeInTheDocument();
  });

  it("offers the WhatsApp order when card payment has been switched off", async () => {
    stubCardSdk();
    listenForPay(() => apiError(503, "CHECKOUT_UNAVAILABLE"));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Online payment isn't available right now. Order on WhatsApp instead.");
    expect(within(alert).getByRole("link", { name: /Order on WhatsApp/ })).toHaveAttribute("href", expect.stringContaining("wa.me"));
  });

  it("does not ask Tap for a token while the card form is invalid", async () => {
    const { sdk, call } = stubCardSdk();
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="ar" onBack={vi.fn()} />, { locale: "ar" });
    const pay = await screen.findByRole("button", { name: PAY_AR });
    await waitFor(() => expect(pay).toBeEnabled());

    call("onInvalidInput");
    await user.click(pay);
    expect(await screen.findByRole("alert")).toHaveTextContent("بيانات البطاقة ناقصة أو غير صحيحة. تأكّد من رقم البطاقة وتاريخ الانتهاء والرمز الأمني، ومن كتابة اسم حامل البطاقة بالأحرف الإنجليزية.");
    expect(screen.getByRole("button", { name: PAY_AR })).toBeEnabled();
    expect(sdk.tokenize).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("frees Pay after 30 s when Tap never answers, and pays nothing with Tap's late token", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { sdk, call } = stubCardSdk();
    vi.mocked(sdk.tokenize).mockImplementationOnce(() => undefined);
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: PAY });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);
    expect(await screen.findByRole("button", { name: "Processing…" })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(TOKENIZE_TIMEOUT_MS));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.getByRole("button", { name: PAY })).toBeEnabled();

    call("onSuccess", { id: "tok_late" });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(sent).toEqual([]);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("checkout: pay step, a card form that never gets ready", () => {
  afterEach(() => vi.useRealTimers());

  it("says so after 20 s and offers a reload, keeping the form in case it still arrives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { sdk, state, unmount, call } = stubCardSdk();
    vi.mocked(sdk.renderTapCard).mockImplementationOnce((_id, config) => {
      state.config = config;
      return { unmount };
    });
    renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    await waitFor(() => expect(state.config).not.toBeNull());

    await act(() => vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS));
    expect(await screen.findByRole("alert")).toHaveTextContent("The card form couldn't load.");
    expect(screen.getByRole("button", { name: "Reload the card form" })).toBeInTheDocument();
    expect(unmount).not.toHaveBeenCalled();

    // late, but there: the message goes and Pay works
    act(() => call("onReady"));
    await waitFor(() => expect(screen.getByRole("button", { name: PAY })).toBeEnabled());
    expect(screen.queryByText(/The card form couldn't load/)).not.toBeInTheDocument();
  });
});
