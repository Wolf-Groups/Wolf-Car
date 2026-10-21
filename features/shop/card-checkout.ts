/**
 * Tap's public key for the card form, baked into the build: `next build`
 * inlines every `process.env.NEXT_PUBLIC_*` reference (Dockerfile build arg
 * NEXT_PUBLIC_TAP_PUBLIC_KEY). It is also the launch switch for card
 * checkout: built without it, the basket offers WhatsApp only and /checkout
 * says card payment is not available yet.
 */
export function tapPublicKey(): string {
  return process.env.NEXT_PUBLIC_TAP_PUBLIC_KEY?.trim() ?? "";
}

export function cardCheckoutEnabled(): boolean {
  return tapPublicKey() !== "";
}
