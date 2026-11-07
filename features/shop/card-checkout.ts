/**
 * Tap's public key for the card form, baked into the build: `next build`
 * inlines every `process.env.NEXT_PUBLIC_*` reference (Dockerfile build arg
 * NEXT_PUBLIC_TAP_PUBLIC_KEY). It is also the launch switch for card
 * payment: built without it, the checkout still takes orders, to be paid at
 * the branch when collected.
 */
export function tapPublicKey(): string {
  return process.env.NEXT_PUBLIC_TAP_PUBLIC_KEY?.trim() ?? "";
}

export function cardCheckoutEnabled(): boolean {
  return tapPublicKey() !== "";
}
