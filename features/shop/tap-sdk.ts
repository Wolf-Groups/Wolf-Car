import { todo } from "./todo";

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

/**
 * Resolves at once when `window.CardSDK` exists (tests and Playwright inject a
 * stub); otherwise appends the script once and resolves on `load`, rejecting
 * with `Error('TAP_SDK_LOAD')` on `error`.
 */
export function loadTapSdk(): Promise<CardSdk> {
  return todo("loadTapSdk");
}
