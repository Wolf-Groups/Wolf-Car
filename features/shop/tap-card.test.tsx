import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeCardSdk, stubCardSdk } from "@/tests/shop-fixtures";
import { READY_TIMEOUT_MS, TAP_CARD_INVALID, TAP_CARD_TIMEOUT, TapCard, type TapCardHandle, TOKENIZE_TIMEOUT_MS } from "./tap-card";
import { TAP_SDK_URL, type TapToken } from "./tap-sdk";

const sdkScripts = () => document.querySelectorAll<HTMLScriptElement>(`script[src="${TAP_SDK_URL}"]`);

afterEach(() => {
  removeCardSdk();
  sdkScripts().forEach((s) => s.remove());
  document.documentElement.classList.remove("dark");
});

function renderCard(
  locale: "ar" | "en" = "en",
  extra: {
    onReady?: () => void;
    onError?: (message: string) => void;
    onValidityChange?: (valid: boolean) => void;
    onLoadError?: (reason: "script" | "timeout") => void;
    nameOnCard?: string;
    frameTitle?: string;
  } = {},
) {
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

  it("keeps the card fields left-to-right in Arabic, with Arabic labels", async () => {
    // right-to-left showed 4012 0000 3333 0026 as "0026 3333 0000 4012" and broke correcting a digit
    const { sdk } = stubCardSdk();
    renderCard("ar");
    await waitFor(() => expect(sdk.renderTapCard).toHaveBeenCalled());
    expect(sdk.renderTapCard).toHaveBeenCalledWith("tap-card-sdk", expect.objectContaining({ interface: expect.objectContaining({ locale: "ar", direction: "ltr" }) }));
  });

  it("matches the site's dark mode, and follows a switch without rebuilding the form", async () => {
    document.documentElement.classList.add("dark");
    const { sdk, state } = stubCardSdk();
    renderCard();
    await waitFor(() => expect(state.config).not.toBeNull());
    expect(state.config).toMatchObject({ interface: { theme: "dark" } });

    act(() => document.documentElement.classList.remove("dark"));
    await waitFor(() => expect(sdk.updateTheme).toHaveBeenLastCalledWith("light"));
    // a new form would lose what the customer typed
    expect(sdk.renderTapCard).toHaveBeenCalledTimes(1);
  });

  it("tells the page when the card becomes complete or incomplete, once per change", async () => {
    const { state, call } = stubCardSdk();
    const onValidityChange = vi.fn();
    renderCard("en", { onValidityChange });
    await waitFor(() => expect(state.config).not.toBeNull());

    // the real SDK calls both on every keystroke, onInvalidInput last
    call("onValidInput", false);
    call("onInvalidInput", true);
    call("onValidInput", false);
    call("onInvalidInput", true);
    expect(onValidityChange.mock.calls).toEqual([[false]]);

    call("onValidInput", true);
    call("onInvalidInput", false);
    expect(onValidityChange.mock.calls).toEqual([[false], [true]]);
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
      // the page shows the accepted cards in a line of its own that never moves
      addons: { loader: true, saveCard: false, displayPaymentBrands: false },
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

  it("pre-fills the name on the card when given, and never redraws the form for another one", async () => {
    const { sdk, state } = stubCardSdk();
    const ref = createRef<TapCardHandle>();
    const view = render(<TapCard ref={ref} publicKey="pk_test_wolfcar" amount="619.50" locale="en" nameOnCard="Sara Ali" />);
    await waitFor(() => expect(state.config).not.toBeNull());
    expect(state.config).toMatchObject({ customer: { nameOnCard: "Sara Ali", editable: true } });

    view.rerender(<TapCard ref={ref} publicKey="pk_test_wolfcar" amount="619.50" locale="en" nameOnCard="Someone Else" />);
    // a redraw would call renderTapCard once the SDK's promise settles: let it
    await act(async () => {});
    expect(sdk.renderTapCard).toHaveBeenCalledTimes(1);
  });

  it("sends no customer to Tap when there is no name to pre-fill", async () => {
    const { state } = stubCardSdk();
    renderCard();
    await waitFor(() => expect(state.config).not.toBeNull());
    expect(state.config).not.toHaveProperty("customer");
  });

  it("renames Tap's English frame title in the page's language once the form is ready", async () => {
    stubCardSdk();
    const onReady = vi.fn();
    const { container } = renderCard("ar", { onReady, frameTitle: "نموذج بيانات البطاقة الآمن من Tap" });
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(container.querySelector("#tap-card-iframe")).toHaveAttribute("title", "نموذج بيانات البطاقة الآمن من Tap");
  });

  it("reset() empties Tap's form in place and asks for the card again before any tokenize", async () => {
    const { sdk, state, call } = stubCardSdk();
    const { ref } = renderCard();
    await waitFor(() => expect(state.config).not.toBeNull());
    call("onValidInput", true);
    call("onInvalidInput", false);

    ref.current!.reset();
    expect(sdk.resetCardInputs).toHaveBeenCalledTimes(1);
    // Tap reports nothing about the emptied form: Pay must not wait on a tokenize that never answers
    await expect(ref.current!.tokenize()).rejects.toThrow(TAP_CARD_INVALID);
    expect(sdk.tokenize).not.toHaveBeenCalled();
    expect(sdk.renderTapCard).toHaveBeenCalledTimes(1);

    call("onValidInput", true);
    call("onInvalidInput", false);
    await expect(ref.current!.tokenize()).resolves.toMatchObject({ id: "tok_fake_ok" });
  });

  it("tells the page when Tap's script cannot load", async () => {
    const onLoadError = vi.fn();
    const onError = vi.fn();
    renderCard("en", { onLoadError, onError });
    await waitFor(() => expect(sdkScripts()).toHaveLength(1));
    sdkScripts()[0].dispatchEvent(new Event("error"));
    await waitFor(() => expect(onLoadError).toHaveBeenCalledWith("script"));
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps Tap's frame see-through on the dark page, and out of reach while inert, without a redraw", async () => {
    const { sdk, state } = stubCardSdk();
    const ref = createRef<TapCardHandle>();
    const view = render(<TapCard ref={ref} publicKey="pk_test_wolfcar" amount="619.50" locale="en" />);
    await waitFor(() => expect(state.config).not.toBeNull());
    const box = view.container.querySelector("#tap-card-sdk")!;
    expect(box).toHaveClass("[color-scheme:light]");
    expect(box).not.toHaveAttribute("inert");

    view.rerender(<TapCard ref={ref} publicKey="pk_test_wolfcar" amount="619.50" locale="en" inert />);
    expect(box).toHaveAttribute("inert");
    await act(async () => {});
    expect(sdk.renderTapCard).toHaveBeenCalledTimes(1);
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
    const { sdk, state, call } = stubCardSdk({ wipeAfterToken: false });
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

describe("Tap card: a form that never gets ready", () => {
  afterEach(() => vi.useRealTimers());

  it("tells the page after READY_TIMEOUT_MS (20 s), and keeps the form in case it still arrives", async () => {
    expect(READY_TIMEOUT_MS).toBe(20_000);
    const { sdk, state, unmount } = stubCardSdk();
    // Tap's frame was blocked: no onReady
    vi.mocked(sdk.renderTapCard).mockImplementationOnce((_id, config) => {
      state.config = config;
      return { unmount };
    });
    const onLoadError = vi.fn();
    const onReady = vi.fn();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderCard("en", { onLoadError, onReady });
    // the SDK is already on the page: its promise settles without the clock moving
    await vi.advanceTimersByTimeAsync(0);
    expect(state.config).not.toBeNull();

    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 1);
    expect(onLoadError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onLoadError).toHaveBeenCalledWith("timeout");
    expect(unmount).not.toHaveBeenCalled();

    (state.config!.onReady as () => void)();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("also tells the page when Tap's script never finishes downloading (no load, no error)", async () => {
    // no SDK on the page: loadTapSdk adds the script tag, which jsdom never loads, like a stalled request
    const onLoadError = vi.fn();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderCard("en", { onLoadError });
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 1);
    expect(onLoadError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onLoadError).toHaveBeenCalledWith("timeout");
  });

  it("says nothing when the form is ready in time", async () => {
    const { state } = stubCardSdk();
    const onLoadError = vi.fn();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderCard("en", { onLoadError });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.config).not.toBeNull();
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS * 2);
    expect(onLoadError).not.toHaveBeenCalled();
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
