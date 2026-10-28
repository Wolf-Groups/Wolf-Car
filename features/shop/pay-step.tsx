"use client";

import { LoaderCircle, Lock, MapPin, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CartLine } from "@/features/catalog/cart";
import { useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/client";
import type { WebOrder } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { paidOrHeld } from "./checkout-state";
import { OrderLines } from "./order-lines";
import { shop } from "./shop-api";
import { TAP_CARD_CONTAINER_ID, TAP_CARD_INVALID, TapCard, type TapCardHandle } from "./tap-card";
import type { TapToken } from "./tap-sdk";
import { useCheckoutError } from "./use-checkout-error";
import { WhatsAppOrderLink } from "./whatsapp-order-link";

export interface PayStepProps {
  order: WebOrder;
  publicKey: string;
  locale: "ar" | "en";
  /** the order expired (ORDER_NOT_PAYABLE): back to the details step */
  onBack: () => void;
  /** the step opened by itself (a resume or a reload), not after "Continue": the card is brought into view once */
  resumed?: boolean;
}

/** Tap's name-on-card field takes Latin letters only, and drops the first letter of a pre-filled Arabic name. */
const LATIN_NAME = /^[A-Za-z][A-Za-z .'-]{2,}$/;

/** The order's lines as basket lines, for the WhatsApp message offered when the card cannot be used. */
const asCartLines = (order: WebOrder): CartLine[] =>
  order.items.map((i) => ({ id: i.productId, name: i.productName, price: i.unitPrice, thumbUrl: i.thumbUrl, qty: i.quantity }));

function scrollToCard() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(TAP_CARD_CONTAINER_ID)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

interface PayError {
  text: string;
  /** card payment is off for now: offer the WhatsApp order next to the message */
  whatsapp?: boolean;
  /** the session no longer matches the order: a reload signs in again or starts over for whoever is signed in */
  reload?: boolean;
}

/** Step 4: total, pickup branch, the Tap card and the Pay button; follows Tap's redirect. */
export function PayStep({ order, publicKey, locale, onBack, resumed = false }: PayStepProps) {
  const t = useTranslations("Checkout");
  const message = useCheckoutError();
  const router = useRouter();
  const card = useRef<TapCardHandle>(null);
  /** one payment at a time: Tap would make a second charge for a second press */
  const paying = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PayError | null>(null);
  const [expired, setExpired] = useState(false);
  /** the card Tap took, shown over its emptied form while the payment is confirmed */
  const [processing, setProcessing] = useState<TapToken | null>(null);
  const [loadFailed, setLoadFailed] = useState<"script" | "timeout" | null>(null);
  /** bumped by "Reload the card form": a new TapCard, which loads Tap again */
  const [attempt, setAttempt] = useState(0);
  const backButton = useRef<HTMLButtonElement>(null);
  const cardHeading = useRef<HTMLHeadingElement>(null);
  /** said to screen readers only, from an element that is always there so each change is announced */
  const [announcement, setAnnouncement] = useState("");
  const branch = locale === "ar" ? order.branch.nameAr : order.branch.name;
  const name = order.customer.name?.trim() ?? "";
  const total = formatMoney(order.total, locale);

  // Back from Tap's 3-D Secure page, the browser may restore this page as it was left: "Processing…"
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setProcessing(null);
      setAnnouncement("");
      if (!paying.current) return setBusy(false);
      // That charge may have been decided at the bank since: Tap is asked before Pay is offered again.
      // Pay stays off meanwhile; a second press now could charge twice.
      shop.reconcile(order.id).then(
        (latest) => {
          if (paidOrHeld(latest)) return router.replace(`/checkout/return?order=${order.id}`);
          paying.current = false;
          setBusy(false);
          // Tap emptied its form when it took the card: either way the card is typed again
          setError({ text: latest.lastPayment?.status === "FAILED" ? t("errors.PAYMENT_FAILED") : t("errors.CARD_REENTER") });
        },
        () => {
          paying.current = false;
          setBusy(false);
          setError({ text: t("errors.CARD_REENTER") });
        },
      );
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, [order.id, router, t]);

  useEffect(() => {
    if (expired) backButton.current?.focus();
  }, [expired]);

  // "Reload the card form" took away the focused button: focus goes to the card section it reloads
  useEffect(() => {
    if (attempt > 0) cardHeading.current?.focus();
  }, [attempt]);

  // opened by itself (a reload, Back from the bank, "Try another card"): the card, not the order list, is what is left to do
  const broughtIntoView = useRef(false);
  useEffect(() => {
    if (!resumed || !ready || broughtIntoView.current) return;
    broughtIntoView.current = true;
    // a customer already scrolling is not moved
    if (window.scrollY < 40) scrollToCard();
  }, [resumed, ready]);

  const pay = async () => {
    if (paying.current || !card.current) return;
    paying.current = true;
    setBusy(true);
    setError(null);
    let token: TapToken | null = null;
    try {
      token = await card.current.tokenize();
      setProcessing(token);
      setAnnouncement(t("confirming"));
      const { redirectUrl } = await shop.pay(order.id, token.id, locale);
      // the page is being left: Pay stays disabled
      if (redirectUrl) window.location.assign(redirectUrl);
      else router.push(`/checkout/return?order=${order.id}`);
    } catch (e) {
      paying.current = false;
      setBusy(false);
      setProcessing(null);
      setAnnouncement("");
      if (e instanceof ApiError && e.code === "ORDER_NOT_PAYABLE") return setExpired(true);
      // paid meanwhile (another tab, an earlier try that went through): its result page has the order code
      if (e instanceof ApiError && e.code === "ALREADY_PAID") return router.replace(`/checkout/return?order=${order.id}`);
      if (e instanceof ApiError && e.code === "CHECKOUT_UNAVAILABLE") return setError({ text: message(e), whatsapp: true });
      if (e instanceof Error && e.message === TAP_CARD_INVALID) {
        setError({ text: t("errors.TAP_CARD_INVALID") });
        return scrollToCard();
      }
      // Signed out meanwhile (another tab), or another number is signed in now: typing the card again
      // cannot help. A reload asks for the code, or starts over for whoever is signed in.
      if (token && e instanceof ApiError && (e.status === 401 || e.status === 404)) return setError({ text: t("errors.SESSION_CHANGED"), reload: true });
      // Tap empties its form as soon as it issues a token: from here on, trying again needs the card typed again
      if (token) {
        setError({ text: e instanceof ApiError && e.code === "PAYMENT_FAILED" ? t("errors.PAYMENT_FAILED") : t("errors.CARD_REENTER") });
        return scrollToCard();
      }
      setError({ text: message(e) });
    }
  };

  const clearCard = () => {
    card.current?.reset();
    setError(null);
    setAnnouncement(t("cardCleared"));
  };

  const reloadCard = () => {
    // Tap's script never arrived: a new tag for the same address would wait on the same stalled request,
    // so the page itself is fetched again (?order= reopens this step; nothing was typed, nothing paid)
    if (!window.CardSDK) return window.location.reload();
    setLoadFailed(null);
    setReady(false);
    setAttempt((n) => n + 1);
  };

  return (
    <div className="grid gap-6">
      <section aria-labelledby="checkout-pay-summary" className="grid gap-1">
        <h2 id="checkout-pay-summary" className="text-[17px] font-extrabold">
          {t("summary")}
        </h2>
        <OrderLines items={order.items} total={order.total} currency={order.currency} />
        <p className="mt-2 flex items-center gap-2 text-[15px] text-ink-2">
          <MapPin className="size-4 shrink-0" aria-hidden="true" />
          {t("pickupAt", { branch })}
        </p>
      </section>

      {expired ? (
        <div className="grid gap-3">
          <p role="alert" className="rounded-[var(--radius-brand)] bg-danger-soft px-3 py-2.5 text-[15px] font-semibold text-danger">
            {t("payExpired")}
          </p>
          <Button ref={backButton} type="button" variant="outline" onClick={onBack} className="justify-self-start">
            {t("backToDetails")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <section aria-labelledby="checkout-card" aria-describedby="checkout-card-hint" className="grid gap-3 border-t border-line pt-5">
            <div className="grid gap-1">
              <h2 ref={cardHeading} id="checkout-card" tabIndex={-1} className="text-[17px] font-extrabold outline-none">
                {t("cardTitle")}
              </h2>
              <p id="checkout-card-hint" className="text-[13px] leading-relaxed text-ink-2">
                {t("cardHint")}
              </p>
            </div>

            {/* Always this wrapper around the card: a new parent would redraw Tap's form and empty it.
                Under 370px it takes 16px more on each side, or Tap's clear-all X runs into the CVV; any
                wider and Tap narrows its CVV field so far that the Arabic placeholder is cut. */}
            <div className={cn("relative max-[369px]:-mx-4", ((!ready && loadFailed !== "script") || processing) && "min-h-[95px]")}>
              {loadFailed !== "script" && (
                <TapCard
                  key={attempt}
                  ref={card}
                  publicKey={publicKey}
                  amount={order.total}
                  locale={locale}
                  nameOnCard={LATIN_NAME.test(name) ? name : undefined}
                  frameTitle={t("frameTitle")}
                  onReady={() => {
                    setReady(true);
                    setLoadFailed(null);
                  }}
                  onLoadError={setLoadFailed}
                  inert={processing !== null}
                  onError={() => setError({ text: t("errors.generic") })}
                  // a message about the last attempt is out of date once the customer has corrected the card
                  onValidityChange={(valid) => {
                    if (valid) setError(null);
                  }}
                />
              )}
              {!ready && !loadFailed && (
                <div
                  role="status"
                  className="absolute inset-0 flex items-center gap-2 rounded-[var(--radius-brand)] border border-line bg-surface px-4 text-[14px] text-ink-2"
                >
                  <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {t("cardLoading")}
                </div>
              )}
              {processing && (
                // announced through the status line below; this is what a sighted customer sees
                <div
                  aria-hidden="true"
                  className="absolute inset-0 z-10 grid place-items-center rounded-[var(--radius-brand)] bg-surface px-4 text-center"
                >
                  <div className="grid justify-items-center gap-1">
                    {processing.card?.last_four && (
                      <p dir="ltr" className="flex items-center gap-2 text-[15px] font-bold tabular-nums">
                        <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        {processing.card.brand} •••• {processing.card.last_four}
                      </p>
                    )}
                    <p className="text-[13px] text-ink-2">{t("confirming")}</p>
                  </div>
                </div>
              )}
            </div>

            {loadFailed && !ready && (
              <div className="grid justify-items-start gap-3 rounded-[var(--radius-brand)] border border-line bg-surface p-4">
                <p role="alert" className="text-[15px] text-ink-2">
                  {t("cardLoadFailed")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={reloadCard} className="h-auto min-h-12 shrink whitespace-normal py-2 text-start">
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {t("reloadCard")}
                  </Button>
                  <WhatsAppOrderLink lines={asCartLines(order)} />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <p className="text-[13px] text-ink-2">{t("acceptedCards")}</p>
              {ready && (
                <Button type="button" variant="link" onClick={clearCard} disabled={busy} className="h-auto min-h-11 px-0 text-[13px] text-ink-2 hover:text-ink">
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {t("clearCard")}
                </Button>
              )}
            </div>

            {error && (
              <div
                id="checkout-pay-error"
                role="alert"
                className="grid justify-items-start gap-3 rounded-[var(--radius-brand)] bg-danger-soft px-3 py-2.5 text-[15px] font-semibold text-danger"
              >
                <p>{error.text}</p>
                {error.whatsapp && <WhatsAppOrderLink lines={asCartLines(order)} />}
                {error.reload && (
                  <Button type="button" variant="outline" onClick={() => window.location.reload()} className="h-auto min-h-11 shrink whitespace-normal py-2">
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {t("reloadPage")}
                  </Button>
                )}
              </div>
            )}
            <p role="status" className="sr-only">
              {announcement}
            </p>
          </section>

          <Button type="button" size="lg" onClick={pay} disabled={!ready || busy} aria-describedby={error ? "checkout-pay-error" : undefined}>
            {busy ? t("paying") : t("payAmount", { amount: total })}
          </Button>
          <p className="flex items-start gap-2 text-[13px] text-ink-2">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t("payNote")}
          </p>
        </div>
      )}
    </div>
  );
}
