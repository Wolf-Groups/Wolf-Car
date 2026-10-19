"use client";

import { forwardRef } from "react";
import type { TapToken } from "./tap-sdk";
import { todo } from "./todo";

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

/** The Tap card form in `<div id="tap-card-sdk" />`; mounted through `loadTapSdk`, unmounted on cleanup. */
export const TapCard = forwardRef<TapCardHandle, TapCardProps>(function TapCard(props, ref) {
  return todo("TapCard", props, ref);
});
