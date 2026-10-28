import { render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeCardSdk, stubCardSdk } from "@/tests/shop-fixtures";
import { TAP_CARD_INVALID, TAP_CARD_TIMEOUT, TapCard, type TapCardHandle, TOKENIZE_TIMEOUT_MS } from "./tap-card";
import { TAP_SDK_URL, type TapToken } from "./tap-sdk";

const sdkScripts = () => document.querySelectorAll<HTMLScriptElement>(`script[src="${TAP_SDK_URL}"]`);

afterEach(() => {
  removeCardSdk();
  sdkScripts().forEach((s) => s.remove());
});

function renderCard(locale: "ar" | "en" = "en", extra: { onReady?: () => void; onError?: (message: string) => void } = {}) {
  const ref = createRef<TapCardHandle>();
  const view = render(<TapCard ref={ref} publicKey="pk_test_wolfcar" amount="619.50" locale={locale} {...extra} />);
  return { ref, ...view };
}

describe("Tap card", () => {
  it("renders Tap's form into #tap-card-sdk with the key, the amount as a number in QAR and the page's language", async () => {
    const { sdk } = stubCardSdk();
    const { container } = renderCard("en");
    expect(container.querySelector("#tap-card-sdk")).toBeInTheDocument();

    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalledTimes(1));
    expect(sdk.renderTapCard).toHaveBeenCalledWith(
      "tap-card-sdk",
      expect.objectContaining({
        publicKey: "pk_test_wolfcar",
        transaction: { amount: 619.5, currency: "QAR" },
        interface: expect.objectContaining({ locale: "en", direction: "ltr" }),
      }),
    );
  });

  it("is right-to-left in Arabic", async () => {
    const { sdk } = stubCardSdk();
    renderCard("ar");
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalled());
    expect(sdk.renderTapCard).toHaveBeenCalledWith("tap-card-sdk", expect.objectContaining({ interface: expect.objectContaining({ locale: "ar", direction: "rtl" }) }));
  });

  it("only takes Visa and Mastercard and never offers to save the card", async () => {
    const { sdk, state } = stubCardSdk();
    renderCard();
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalled());
    expect(state.config).toMatchObject({
      publicKey: "pk_test_wolfcar",
      transaction: { amount: 619.5, currency: "QAR" },
      acceptance: { supportedBrands: ["VISA", "MASTERCARD"], supportedCards: "ALL" },
      fields: { cardHolder: true },
      addons: { loader: true, saveCard: false, displayPaymentBrands: true },
      interface: { locale: "en", theme: "light", edges: "curved", direction: "ltr" },
    });
  });

  it("tells the page when the form is ready", async () => {
    stubCardSdk();
    const onReady = vi.fn();
    renderCard("en", { onReady });
    await waitFor(() => expect(onReady).toHaveBeenCalled());
  });

  it("tokenize() asks Tap for a token and resolves with the token of the next onSuccess", async () => {
    const token: TapToken = { id: "tok_abc123", card: { last_four: "1019", brand: "VISA" } };
    const { sdk } = stubCardSdk({ token });
    const { ref } = renderCard();
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalled());

    await expect(ref.current!.tokenize()).resolves.toEqual(token);
    expect(sdk.tokenize).toHaveBeenCalledTimes(1);
  });

  it("tokenize() rejects on the next onError and tells the page", async () => {
    const { sdk } = stubCardSdk({ fail: "Card number is invalid" });
    const onError = vi.fn();
    const { ref } = renderCard("en", { onError });
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalled());

    await expect(ref.current!.tokenize()).rejects.toBeDefined();
    expect(onError).toHaveBeenCalledWith("Card number is invalid");
  });

  it("can tokenize again after a failure", async () => {
    const { sdk, state, call } = stubCardSdk();
    vi.mocked(sdk.tokenize).mockImplementationOnce(() => queueMicrotask(() => call("onError", "declined")));
    const { ref } = renderCard();
    await waitFor(() => expect(state.config).not.toBeNull());

    await expect(ref.current!.tokenize()).rejects.toBeDefined();
    await expect(ref.current!.tokenize()).resolves.toMatchObject({ id: "tok_fake_ok" });
  });

  it("unmounts Tap's form when the card goes away", async () => {
    const { sdk, unmount } = stubCardSdk();
    const view = renderCard();
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalled());
    view.unmount();
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});

describe("Tap card: a tokenize Tap does not answer never hangs", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects the tokenize in flight with TAP_CARD_INVALID when Tap reports the card fields invalid", async () => {
    const { sdk, state, call } = stubCardSdk();
    // Tap only marks the wrong field: neither onSuccess nor onError
    vi.mocked(sdk.tokenize).mockImplementationOnce(() => undefined);
    const { ref } = renderCard();
    await waitFor(() => expect(state.config).not.toBeNull());

    const tokenizing = ref.current!.tokenize();
    call("onInvalidInput");
    await expect(tokenizing).rejects.toThrow(TAP_CARD_INVALID);
  });

  it("rejects at once, without asking Tap, while Tap's last report was invalid; tokenizes again once valid", async () => {
    const { sdk, state, call } = stubCardSdk();
    const { ref } = renderCard();
    await waitFor(() => expect(state.config).not.toBeNull());

    call("onInvalidInput");
    await expect(ref.current!.tokenize()).rejects.toThrow(TAP_CARD_INVALID);
    expect(sdk.tokenize).not.toHaveBeenCalled();

    call("onValidInput");
    await expect(ref.current!.tokenize()).resolves.toMatchObject({ id: "tok_fake_ok" });
    expect(sdk.tokenize).toHaveBeenCalledTimes(1);
  });

  it("reads Tap's flag: the real SDK calls both callbacks on every change, onInvalidInput last", async () => {
    const { sdk, state, call } = stubCardSdk();
    const { ref } = renderCard();
    await waitFor(() => expect(state.config).not.toBeNull());

    // seen in Tap's sandbox (card SDK 1.0.2) while the card is incomplete...
    call("onValidInput", false);
    call("onInvalidInput", true);
    await expect(ref.current!.tokenize()).rejects.toThrow(TAP_CARD_INVALID);
    expect(sdk.tokenize).not.toHaveBeenCalled();

    // ...and once it is complete
    call("onValidInput", true);
    call("onInvalidInput", false);
    await expect(ref.current!.tokenize()).resolves.toMatchObject({ id: "tok_fake_ok" });
    expect(sdk.tokenize).toHaveBeenCalledTimes(1);
  });

  it("gives up after TOKENIZE_TIMEOUT_MS (30 s) and ignores Tap's late answer", async () => {
    expect(TOKENIZE_TIMEOUT_MS).toBe(30_000);
    const { sdk, state, call } = stubCardSdk();
    vi.mocked(sdk.tokenize).mockImplementationOnce(() => undefined);
    const { ref } = renderCard();
    await waitFor(() => expect(state.config).not.toBeNull());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const tokenizing = ref.current!.tokenize();
    const settled = vi.fn();
    tokenizing.then(settled, settled);
    await vi.advanceTimersByTimeAsync(TOKENIZE_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(tokenizing).rejects.toThrow(TAP_CARD_TIMEOUT);

    // the late token settles nothing: the next tokenize waits for an answer of its own
    call("onSuccess", { id: "tok_late" });
    await expect(ref.current!.tokenize()).resolves.toMatchObject({ id: "tok_fake_ok" });
    expect(sdk.tokenize).toHaveBeenCalledTimes(2);
  });
});

describe("loadTapSdk", () => {
  it("resolves at once with an SDK already on the page (tests and Playwright inject one)", async () => {
    const { sdk } = stubCardSdk();
    const { loadTapSdk } = await import("./tap-sdk");
    await expect(loadTapSdk()).resolves.toBe(sdk);
    expect(sdkScripts()).toHaveLength(0);
  });

  it("adds Tap's script once and resolves when it has loaded", async () => {
    vi.resetModules();
    const { loadTapSdk } = await import("./tap-sdk");
    const first = loadTapSdk();
    const second = loadTapSdk();
    expect(sdkScripts()).toHaveLength(1);

    const { sdk } = stubCardSdk();
    sdkScripts()[0].dispatchEvent(new Event("load"));
    await expect(first).resolves.toBe(sdk);
    await expect(second).resolves.toBe(sdk);
  });

  it("rejects with TAP_SDK_LOAD when the script cannot load", async () => {
    vi.resetModules();
    const { loadTapSdk } = await import("./tap-sdk");
    const loading = loadTapSdk();
    expect(sdkScripts()).toHaveLength(1);
    sdkScripts()[0].dispatchEvent(new Event("error"));
    await expect(loading).rejects.toThrow("TAP_SDK_LOAD");
  });
});
