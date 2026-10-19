import { render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeCardSdk, stubCardSdk } from "@/tests/shop-fixtures";
import { TapCard, type TapCardHandle } from "./tap-card";
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
