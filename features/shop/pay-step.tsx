"use client";

import { Lock, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/client";
import type { WebOrder } from "@/lib/api/types";
import { OrderLines } from "./order-lines";
import { shop } from "./shop-api";
import { TAP_CARD_INVALID, TapCard, type TapCardHandle } from "./tap-card";
import { useCheckoutError } from "./use-checkout-error";

export interface PayStepProps {
  order: WebOrder;
  publicKey: string;
  locale: "ar" | "en";
  /** the order expired (ORDER_NOT_PAYABLE): back to the details step */
  onBack: () => void;
}

/** Step 4: total, pickup branch, the Tap card and the Pay button; follows Tap's redirect. */
export function PayStep({ order, publicKey, locale, onBack }: PayStepProps) {
  const t = useTranslations("Checkout");
  const message = useCheckoutError();
  const router = useRouter();
  const card = useRef<TapCardHandle>(null);
  /** one payment at a time: Tap would make a second charge for a second press */
  const paying = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const branch = locale === "ar" ? order.branch.nameAr : order.branch.name;

  // Back from Tap's 3-D Secure page, the browser may restore this page as it was left: "Processing…"
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      paying.current = false;
      setBusy(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  const pay = async () => {
    if (paying.current || !card.current) return;
    paying.current = true;
    setBusy(true);
    setError(null);
    try {
      const token = await card.current.tokenize();
      const { redirectUrl } = await shop.pay(order.id, token.id, locale);
      // the page is being left: Pay stays disabled
      if (redirectUrl) window.location.assign(redirectUrl);
      else router.push(`/checkout/return?order=${order.id}`);
    } catch (e) {
      paying.current = false;
      setBusy(false);
      if (e instanceof ApiError && e.code === "ORDER_NOT_PAYABLE") setExpired(true);
      // Tap marks the wrong field itself; a timeout or any other card failure gets the shared rule (generic)
      else if (e instanceof Error && e.message === TAP_CARD_INVALID) setError(t("errors.TAP_CARD_INVALID"));
      else setError(message(e));
    }
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
            {t("expired")}
          </p>
          <Button type="button" variant="outline" onClick={onBack} className="justify-self-start">
            {t("backToDetails")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <TapCard
            ref={card}
            publicKey={publicKey}
            amount={order.total}
            locale={locale}
            onReady={() => setReady(true)}
            onError={() => setError(t("errors.generic"))}
          />
          <p className="flex items-start gap-2 text-[13px] text-ink-2">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t("payNote")}
          </p>
          {error && (
            <p role="alert" className="rounded-[var(--radius-brand)] bg-danger-soft px-3 py-2.5 text-[15px] font-semibold text-danger">
              {error}
            </p>
          )}
          <Button type="button" size="lg" onClick={pay} disabled={!ready || busy}>
            {busy ? t("paying") : t("pay")}
          </Button>
        </div>
      )}
    </div>
  );
}
