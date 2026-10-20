"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { type CardSdk, loadTapSdk, type TapToken } from "./tap-sdk";

export interface TapCardHandle {
  /** resolves with the next `onSuccess` token, rejects on the next `onError`; one in flight at a time */
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

const CONTAINER_ID = "tap-card-sdk";

interface Pending {
  promise: Promise<TapToken>;
  resolve: (token: TapToken) => void;
  reject: (error: Error) => void;
}

/** Tap passes a string or an error object; the page only needs something to log or show. */
function messageOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  return "TAP_ERROR";
}

/** The Tap card form in `<div id="tap-card-sdk" />`; mounted through `loadTapSdk`, unmounted on cleanup. */
export const TapCard = forwardRef<TapCardHandle, TapCardProps>(function TapCard({ publicKey, amount, locale, onReady, onError }, ref) {
  /** the SDK once Tap's form is on the page, null before and after */
  const sdk = useRef<CardSdk | null>(null);
  const pending = useRef<Pending | null>(null);
  // the latest callbacks, so a new arrow function from the page does not re-render Tap's form
  const callbacks = useRef({ onReady, onError });
  useEffect(() => {
    callbacks.current = { onReady, onError };
  });

  useEffect(() => {
    let active = true;
    let card: { unmount(): void } | null = null;
    const settle = (outcome: { token: TapToken } | { error: string }) => {
      const current = pending.current;
      pending.current = null;
      if (!current) return;
      if ("token" in outcome) current.resolve(outcome.token);
      else current.reject(new Error(outcome.error));
    };

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
          onError: (data: unknown) => {
            if (!active) return;
            const message = messageOf(data);
            settle({ error: message });
            callbacks.current.onError?.(message);
          },
          onSuccess: (token: TapToken) => {
            if (active) settle({ token });
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
      settle({ error: "TAP_CARD_UNMOUNTED" });
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
        let resolve!: (token: TapToken) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<TapToken>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        pending.current = { promise, resolve, reject };
        try {
          loaded.tokenize();
        } catch (error) {
          pending.current = null;
          reject(new Error(messageOf(error)));
        }
        return promise;
      },
    }),
    [],
  );

  return <div id={CONTAINER_ID} />;
});
