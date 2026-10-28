"use client";

import { forwardRef, type RefObject, useEffect, useImperativeHandle, useRef } from "react";
import { type CardSdk, loadTapSdk, type TapToken } from "./tap-sdk";

export interface TapCardHandle {
  /**
   * Resolves with the next `onSuccess` token; rejects on the next `onError`, on
   * `onInvalidInput` (`TAP_CARD_INVALID`, also at once when Tap's last report
   * was invalid) or after `TOKENIZE_TIMEOUT_MS` (`TAP_CARD_TIMEOUT`). One in
   * flight at a time.
   */
  tokenize(): Promise<TapToken>;
}

export interface TapCardProps {
  publicKey: string;
  /** "619.50" */
  amount: string;
  locale: "ar" | "en";
  onReady?: () => void;
  onError?: (message: string) => void;
}

/** The card form is incomplete or wrong: Tap shows which field, the page asks to check it. */
export const TAP_CARD_INVALID = "TAP_CARD_INVALID";
/** Tap never answered a tokenize: the Pay button must not wait forever. */
export const TAP_CARD_TIMEOUT = "TAP_CARD_TIMEOUT";
export const TOKENIZE_TIMEOUT_MS = 30_000;

const CONTAINER_ID = "tap-card-sdk";

interface Pending {
  promise: Promise<TapToken>;
  resolve: (token: TapToken) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Tap passes a string or an error object; the page only needs something to log or show. */
function messageOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  return "TAP_ERROR";
}

/** Ends the tokenize in flight, if any; a callback arriving after that (a late `onSuccess`) finds nothing to settle. */
function settle(pending: RefObject<Pending | null>, outcome: { token: TapToken } | { error: string }): void {
  const current = pending.current;
  pending.current = null;
  if (!current) return;
  clearTimeout(current.timer);
  if ("token" in outcome) current.resolve(outcome.token);
  else current.reject(new Error(outcome.error));
}

/** The Tap card form in `<div id="tap-card-sdk" />`; mounted through `loadTapSdk`, unmounted on cleanup. */
export const TapCard = forwardRef<TapCardHandle, TapCardProps>(function TapCard({ publicKey, amount, locale, onReady, onError }, ref) {
  /** the SDK once Tap's form is on the page, null before and after */
  const sdk = useRef<CardSdk | null>(null);
  const pending = useRef<Pending | null>(null);
  /** Tap's last report on the card fields: null until it sends one */
  const valid = useRef<boolean | null>(null);
  // the latest callbacks, so a new arrow function from the page does not re-render Tap's form
  const callbacks = useRef({ onReady, onError });
  useEffect(() => {
    callbacks.current = { onReady, onError };
  });

  useEffect(() => {
    let active = true;
    let card: { unmount(): void } | null = null;
    valid.current = null;

    loadTapSdk()
      .then((loaded) => {
        if (!active) return;
        card = loaded.renderTapCard(CONTAINER_ID, {
          publicKey,
          transaction: { amount: Number(amount), currency: "QAR" },
          acceptance: { supportedBrands: ["VISA", "MASTERCARD"], supportedCards: "ALL" },
          fields: { cardHolder: true },
          addons: { loader: true, saveCard: false, displayPaymentBrands: true },
          interface: { locale, theme: "light", edges: "curved", direction: locale === "ar" ? "rtl" : "ltr" },
          onReady: () => {
            if (active) callbacks.current.onReady?.();
          },
          // Tap calls both on every change with a flag, onInvalidInput last: (false, true) while
          // the card is incomplete, (true, false) once it is complete
          onValidInput: (isValid?: boolean) => {
            if (active && isValid !== false) valid.current = true;
          },
          onInvalidInput: (isInvalid?: boolean) => {
            if (!active || isInvalid === false) return;
            valid.current = false;
            settle(pending, { error: TAP_CARD_INVALID });
          },
          onError: (data: unknown) => {
            if (!active) return;
            const message = messageOf(data);
            settle(pending, { error: message });
            callbacks.current.onError?.(message);
          },
          onSuccess: (token: TapToken) => {
            if (active) settle(pending, { token });
          },
        });
        sdk.current = loaded;
      })
      // the script failed to load, or Tap refused the config
      .catch((error: unknown) => {
        if (active) callbacks.current.onError?.(messageOf(error));
      });

    return () => {
      active = false;
      sdk.current = null;
      settle(pending, { error: "TAP_CARD_UNMOUNTED" });
      card?.unmount();
    };
  }, [publicKey, amount, locale]);

  useImperativeHandle(
    ref,
    () => ({
      tokenize() {
        if (pending.current) return pending.current.promise;
        const loaded = sdk.current;
        if (!loaded) return Promise.reject(new Error("TAP_CARD_NOT_READY"));
        if (valid.current === false) return Promise.reject(new Error(TAP_CARD_INVALID));
        let resolve!: (token: TapToken) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<TapToken>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        const timer = setTimeout(() => settle(pending, { error: TAP_CARD_TIMEOUT }), TOKENIZE_TIMEOUT_MS);
        pending.current = { promise, resolve, reject, timer };
        try {
          loaded.tokenize();
        } catch (error) {
          settle(pending, { error: messageOf(error) });
        }
        return promise;
      },
    }),
    [],
  );

  return <div id={CONTAINER_ID} />;
});
