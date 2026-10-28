"use client";

import { forwardRef, type RefObject, useEffect, useImperativeHandle, useRef } from "react";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { type CardSdk, loadTapSdk, type TapToken } from "./tap-sdk";

export interface TapCardHandle {
  /**
   * Resolves with the next `onSuccess` token; rejects on the next `onError`, on
   * `onInvalidInput` (`TAP_CARD_INVALID`, also at once when Tap's last report
   * was invalid) or after `TOKENIZE_TIMEOUT_MS` (`TAP_CARD_TIMEOUT`). One in
   * flight at a time.
   */
  tokenize(): Promise<TapToken>;
  /**
   * Empties every card field (Tap's own reset), for a customer who lost their
   * place in Tap's one-row form. Tap does not report the emptied form, so a
   * tokenize before the card is typed again rejects with `TAP_CARD_INVALID`.
   */
  reset(): void;
}

export interface TapCardProps {
  publicKey: string;
  /** "619.50" */
  amount: string;
  locale: "ar" | "en";
  /**
   * Fills Tap's name-on-card field, read once when the form is drawn. Latin
   * letters only: Tap's field drops Arabic letters (and the first one of a pre-filled Arabic name).
   */
  nameOnCard?: string;
  /** the frame's accessible name in the page's language, replacing Tap's English one */
  frameTitle?: string;
  onReady?: () => void;
  /** a runtime error from Tap's form */
  onError?: (message: string) => void;
  /** Tap's verdict on the card fields changed: complete and valid, or not (once per change, not per keystroke) */
  onValidityChange?: (valid: boolean) => void;
  /**
   * There is no form to type into: Tap's script did not load ("script"), or the
   * form was not ready after READY_TIMEOUT_MS ("timeout"; it may still arrive, and onReady then follows).
   */
  onLoadError?: (reason: "script" | "timeout") => void;
}

/** The card form is incomplete or wrong. Tap marks a wrong number or date itself, never a missing field, so the page says what to check. */
export const TAP_CARD_INVALID = "TAP_CARD_INVALID";
/** Tap never answered a tokenize: the Pay button must not wait forever. */
export const TAP_CARD_TIMEOUT = "TAP_CARD_TIMEOUT";
export const TOKENIZE_TIMEOUT_MS = 30_000;
/** Tap's form took up to 8 s to be ready on a fast connection; slow mobile data gets more room before the page offers a reload. */
export const READY_TIMEOUT_MS = 20_000;
/** The div Tap draws into: its own React root lives inside, so nothing else may render there. */
export const TAP_CARD_CONTAINER_ID = "tap-card-sdk";

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

const siteTheme = (): "light" | "dark" => (document.documentElement.classList.contains("dark") ? "dark" : "light");

/** The Tap card form in `<div id="tap-card-sdk" />`; mounted through `loadTapSdk`, unmounted on cleanup. */
export const TapCard = forwardRef<TapCardHandle, TapCardProps>(function TapCard(
  { publicKey, amount, locale, nameOnCard, frameTitle, onReady, onError, onValidityChange, onLoadError },
  ref,
) {
  /** the SDK once Tap's form is on the page, null before and after */
  const sdk = useRef<CardSdk | null>(null);
  const pending = useRef<Pending | null>(null);
  /** Tap's last report on the card fields: null until it sends one */
  const valid = useRef<boolean | null>(null);
  // The latest props, so a new arrow function or name from the page never redraws Tap's form:
  // a redraw empties what the customer typed. Only the key, amount and language redraw it.
  const latest = useRef({ nameOnCard, frameTitle, onReady, onError, onValidityChange, onLoadError });
  useEffect(() => {
    latest.current = { nameOnCard, frameTitle, onReady, onError, onValidityChange, onLoadError };
  });
  const dark = useDarkMode();

  useEffect(() => {
    let active = true;
    let ready = false;
    let card: { unmount(): void } | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    valid.current = null;
    /** records Tap's report and tells the page when it differs from the last one */
    const report = (isValid: boolean) => {
      const changed = valid.current !== isValid;
      valid.current = isValid;
      if (changed) latest.current.onValidityChange?.(isValid);
    };

    loadTapSdk()
      .then((loaded) => {
        if (!active) return;
        const { nameOnCard: name } = latest.current;
        card = loaded.renderTapCard(TAP_CARD_CONTAINER_ID, {
          publicKey,
          transaction: { amount: Number(amount), currency: "QAR" },
          acceptance: { supportedBrands: ["VISA", "MASTERCARD"], supportedCards: "ALL" },
          fields: { cardHolder: true },
          // The page lists the accepted cards in a line of its own that stays put: Tap's logo row
          // disappears as soon as typing starts, which moves everything under the form.
          addons: { loader: true, saveCard: false, displayPaymentBrands: false },
          ...(name ? { customer: { nameOnCard: name, editable: true } } : {}),
          // Card numbers and expiry dates read left to right in Arabic too: right-to-left drew
          // 4012 0000 3333 0026 as "0026 3333 0000 4012" and sent corrections to the wrong digits.
          // The labels stay in the page's language. The theme is the site's at mount; later
          // switches go through updateTheme (below), since a new form would lose the typed card.
          interface: { locale, theme: siteTheme(), edges: "curved", direction: "ltr" },
          onReady: () => {
            if (!active) return;
            ready = true;
            clearTimeout(readyTimer);
            const title = latest.current.frameTitle;
            if (title) document.querySelector(`#${TAP_CARD_CONTAINER_ID} #tap-card-iframe`)?.setAttribute("title", title);
            latest.current.onReady?.();
          },
          // Tap calls both on every change with a flag, onInvalidInput last: (false, true) while
          // the card is incomplete, (true, false) once it is complete
          onValidInput: (isValid?: boolean) => {
            if (active && isValid !== false) report(true);
          },
          onInvalidInput: (isInvalid?: boolean) => {
            if (!active || isInvalid === false) return;
            report(false);
            settle(pending, { error: TAP_CARD_INVALID });
          },
          onError: (data: unknown) => {
            if (!active) return;
            const message = messageOf(data);
            settle(pending, { error: message });
            latest.current.onError?.(message);
          },
          onSuccess: (token: TapToken) => {
            if (active) settle(pending, { token });
          },
        });
        sdk.current = loaded;
        // Tap's frame never loaded (blocked, offline): onReady will not come by itself
        if (!ready) {
          readyTimer = setTimeout(() => {
            if (active) latest.current.onLoadError?.("timeout");
          }, READY_TIMEOUT_MS);
        }
      })
      // the script failed to load, or Tap refused the config: there is no form
      .catch(() => {
        if (active) latest.current.onLoadError?.("script");
      });

    return () => {
      active = false;
      clearTimeout(readyTimer);
      sdk.current = null;
      settle(pending, { error: "TAP_CARD_UNMOUNTED" });
      card?.unmount();
    };
  }, [publicKey, amount, locale]);

  // the site's theme switch restyles the form in place (no-op until Tap's form is on the page)
  useEffect(() => {
    sdk.current?.updateTheme?.(dark ? "dark" : "light");
  }, [dark]);

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
      reset() {
        sdk.current?.resetCardInputs?.();
        // until the customer types the card again, Pay asks for it instead of waiting on Tap
        valid.current = false;
      },
    }),
    [],
  );

  // Tap's frame document declares no color scheme: on the dark page Chrome would paint an opaque
  // white backdrop behind it, so the frame's container says "light" and stays see-through.
  return <div id={TAP_CARD_CONTAINER_ID} className="[color-scheme:light]" />;
});
