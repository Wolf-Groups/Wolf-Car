/** Tap Card SDK Web v2, loaded once on the pay step. */
export const TAP_SDK_URL = "https://tap-sdks.b-cdn.net/card/1.0.2/index.js";

export interface TapToken {
  id: string;
  card?: { last_four?: string; brand?: string };
}

export interface CardSdk {
  renderTapCard(containerId: string, config: Record<string, unknown>): { unmount(): void };
  tokenize(): void;
  Currencies?: Record<string, string>;
}

declare global {
  interface Window {
    CardSDK?: CardSdk;
  }
}

/** The one load in progress, shared by every caller; cleared when it fails so a later visit can try again. */
let loading: Promise<CardSdk> | null = null;

/**
 * Resolves at once when `window.CardSDK` exists (tests and Playwright inject a
 * stub); otherwise appends the script once and resolves on `load`, rejecting
 * with `Error('TAP_SDK_LOAD')` on `error`.
 *
 * Browser only, and only in the top window: a page framed by another site
 * never gets a card form (clickjacking), and on the server there is no SDK.
 */
export function loadTapSdk(): Promise<CardSdk> {
  if (typeof window === "undefined" || window.self !== window.top) return Promise.reject(new Error("TAP_SDK_LOAD"));
  if (window.CardSDK) return Promise.resolve(window.CardSDK);
  if (loading) return loading;

  loading = new Promise<CardSdk>((resolve, reject) => {
    // a script left by an earlier copy of this module (fast refresh) is reused, never doubled
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TAP_SDK_URL}"]`);
    const script = existing ?? document.createElement("script");
    const fail = () => {
      script.remove();
      loading = null;
      reject(new Error("TAP_SDK_LOAD"));
    };
    script.addEventListener("load", () => (window.CardSDK ? resolve(window.CardSDK) : fail()), { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = TAP_SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return loading;
}
