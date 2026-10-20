import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { router } from "@/tests/setup";
import { apiError, ORDER_ID, removeCardSdk, stubCardSdk, webOrder } from "@/tests/shop-fixtures";
import { PayStep } from "./pay-step";
import { TOKENIZE_TIMEOUT_MS } from "./tap-card";

const THREE_DS = "https://acceptance.sandbox.tap.company/gosell/v2/payment/3ds?chg=chg_TS05";
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
    expect(screen.getByText("Secure card payment through Tap. Your card details never reach our servers.")).toBeInTheDocument();
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalledWith("tap-card-sdk", expect.objectContaining({ publicKey: "pk_test_wolfcar" })));
  });

  it("tokenizes the card, pays with the token and follows Tap to 3-D Secure", async () => {
    const { sdk } = stubCardSdk();
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);

    const pay = await screen.findByRole("button", { name: "Pay now" });
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
    const pay = await screen.findByRole("button", { name: "ادفع الآن" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);
    await waitFor(() => expect(sent).toEqual([{ tokenId: "tok_fake_ok", locale: "ar" }]));
  });

  it("goes to the return page itself when Tap captured at once (no redirect)", async () => {
    stubCardSdk();
    listenForPay(() => HttpResponse.json({ redirectUrl: null, order: webOrder({ status: "CONFIRMED", paymentStatus: "PAID" }) }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: "Pay now" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/return?order=${ORDER_ID}`));
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps the step when the card is declined, so another card can be tried", async () => {
    stubCardSdk();
    const sent = listenForPay(() => apiError(402, "PAYMENT_FAILED", { reason: "INVALID_TOKEN" }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: "Pay now" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    expect(await screen.findByRole("alert")).toHaveTextContent("The payment was declined. Try another card.");
    expect(assign).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay now" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Pay now" }));
    await waitFor(() => expect(sent).toHaveLength(2));
  });

  it("says the order expired and offers the way back to the details", async () => {
    stubCardSdk();
    listenForPay(() => apiError(409, "ORDER_NOT_PAYABLE"));
    const onBack = vi.fn();
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={onBack} />);
    const pay = await screen.findByRole("button", { name: "Pay now" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    expect(await screen.findByText("This order has expired. Go back to review your cart and try again.")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
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
    const pay = await screen.findByRole("button", { name: "Pay now" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    const busy = await screen.findByRole("button", { name: "Processing…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    release();

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(1);
  });

  it("says an order that is already paid is paid", async () => {
    stubCardSdk();
    listenForPay(() => apiError(409, "ALREADY_PAID"));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: "Pay now" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    expect(await screen.findByRole("alert")).toHaveTextContent("This order is already paid.");
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks the API nothing when Tap could not read the card", async () => {
    stubCardSdk({ fail: "Card number is invalid" });
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: "Pay now" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    await waitFor(() => expect(screen.getByRole("button", { name: "Pay now" })).toBeEnabled());
    expect(sent).toEqual([]);
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks to check the card when Tap marks it invalid during Pay, and lets the customer press Pay again", async () => {
    const { sdk, call } = stubCardSdk();
    // Tap only marks the wrong field: neither onSuccess nor onError
    vi.mocked(sdk.tokenize).mockImplementationOnce(() => undefined);
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: "Pay now" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);
    expect(await screen.findByRole("button", { name: "Processing…" })).toBeDisabled();

    call("onInvalidInput");
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the card details and try again.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay now" })).toBeEnabled());
    expect(sent).toEqual([]);

    // corrected card: Pay works again
    call("onValidInput");
    await user.click(screen.getByRole("button", { name: "Pay now" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(THREE_DS));
    expect(sent).toEqual([{ tokenId: "tok_fake_ok", locale: "en" }]);
  });

  it("does not ask Tap for a token while the card form is invalid", async () => {
    const { sdk, call } = stubCardSdk();
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="ar" onBack={vi.fn()} />, { locale: "ar" });
    const pay = await screen.findByRole("button", { name: "ادفع الآن" });
    await waitFor(() => expect(pay).toBeEnabled());

    call("onInvalidInput");
    await user.click(pay);
    expect(await screen.findByRole("alert")).toHaveTextContent("راجع بيانات البطاقة وحاول مرة أخرى.");
    expect(screen.getByRole("button", { name: "ادفع الآن" })).toBeEnabled();
    expect(sdk.tokenize).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("frees Pay after 30 s when Tap never answers, and pays nothing with Tap's late token", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { sdk, call } = stubCardSdk();
    vi.mocked(sdk.tokenize).mockImplementationOnce(() => undefined);
    const sent = listenForPay(() => HttpResponse.json({ redirectUrl: THREE_DS, order: webOrder() }));
    const { user } = renderOnSite(<PayStep order={webOrder()} publicKey="pk_test_wolfcar" locale="en" onBack={vi.fn()} />);
    const pay = await screen.findByRole("button", { name: "Pay now" });
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);
    expect(await screen.findByRole("button", { name: "Processing…" })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(TOKENIZE_TIMEOUT_MS));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.getByRole("button", { name: "Pay now" })).toBeEnabled();

    call("onSuccess", { id: "tok_late" });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(sent).toEqual([]);
    expect(assign).not.toHaveBeenCalled();
  });
});
