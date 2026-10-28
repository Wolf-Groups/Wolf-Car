"use client";

import { CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Button, buttonVariants } from "@/components/ui/button";
import { cart } from "@/features/catalog/cart";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/client";
import type { WebOrder } from "@/lib/api/types";
import { getBranches, getHours, telLink } from "@/lib/branches";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import { CHECKOUT_POLL_MAX_MS, CHECKOUT_POLL_MS, localQatarNumber } from "@/shared/shop";
import { OrderLines } from "./order-lines";
import { shop } from "./shop-api";

export interface ReturnStatusProps {
  orderId: string;
}

/** What the server's order says once the payment is decided. */
type Outcome = "paid" | "notPaid" | "expired" | "review" | "refunded";
/** `waiting`: still undecided after CHECKOUT_POLL_MAX_MS; `error`: the order could not be read */
type View = "checking" | Outcome | "waiting" | "error";

const MAX_POLLS = Math.floor(CHECKOUT_POLL_MAX_MS / CHECKOUT_POLL_MS);

/** The order's outcome, or null while the payment is still being decided (keep polling). */
function outcomeOf(order: WebOrder): Outcome | null {
  if (order.paymentStatus === "PAID") return "paid";
  const captured = order.lastPayment?.status === "CAPTURED";
  // Tap took the money but it was held back (AMOUNT_MISMATCH, or DUPLICATE_CAPTURE after a refund): the branch sorts it out
  if (captured && order.lastPayment?.failureCode) return "review";
  if (order.paymentStatus === "REFUNDED") return "refunded";
  // a clean capture always comes with PAID; seen without it, the money was still taken
  if (captured) return "review";
  // closed without a payment: the expiry sweep cancels it and leaves paymentStatus PENDING and the stale attempt
  if (order.status !== "PENDING" || order.paymentStatus !== "PENDING") return "expired";
  if (order.lastPayment === null || order.lastPayment.status === "INITIATED") return null;
  return "notPaid";
}

/**
 * True the first time this tab does `what` for the order: a reload of this page, or Back to it
 * after starting a new basket, must neither empty that basket nor count the sale twice.
 */
function firstTimeInTab(what: "basket" | "paid", orderId: string): boolean {
  const key = `wolfcar.${what}.${orderId}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
  } catch {
    /* storage blocked: better counted on every visit than never */
  }
  return true;
}

/** "+97471008939" → "+974 7100 8939" */
const displayPhone = (e164: string) => {
  const local = localQatarNumber(e164);
  return `+974 ${local.slice(0, 4)} ${local.slice(4)}`;
};

/** After Tap's redirect: reconcile once, poll while pending, then paid / not paid / expired / in review / refunded. */
export function ReturnStatus({ orderId }: ReturnStatusProps) {
  const t = useTranslations("Checkout");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const router = useRouter();
  const [view, setView] = useState<View>("checking");
  const [order, setOrder] = useState<WebOrder | null>(null);
  /** bumped by "Check again": reconcile and poll once more */
  const [round, setRound] = useState(0);
  const basketCleared = useRef(false);
  const saleReported = useRef(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let seen = false;

    const next = () => {
      if (polls >= MAX_POLLS) setView(seen ? "waiting" : "error");
      else timer = setTimeout(poll, CHECKOUT_POLL_MS);
    };
    const show = (o: WebOrder) => {
      if (!live) return;
      seen = true;
      const outcome = outcomeOf(o);
      // kept while the bank is still deciding too: the waiting view shows its code
      setOrder(o);
      if (outcome === null) return next();
      // the money was taken either way: the order's products are bought, but only a paid order counts as a sale.
      // Only those leave the basket: unpriced lines (for WhatsApp) and anything added since stay
      if ((outcome === "paid" || outcome === "review") && !basketCleared.current) {
        basketCleared.current = true;
        if (firstTimeInTab("basket", o.id)) o.items.forEach((item) => cart.setQty(item.productId, 0));
      }
      if (outcome === "paid" && !saleReported.current) {
        saleReported.current = true;
        if (firstTimeInTab("paid", o.id)) track("order_paid");
      }
      setView(outcome);
    };
    const fail = (e: unknown) => {
      if (!live) return;
      // the session cookie is gone: sign in again at the checkout, which then picks this order up again
      if (e instanceof ApiError && e.status === 401) return router.push(`/checkout?order=${orderId}`);
      // not this customer's order, or no order at all: asking again will not change that
      if (e instanceof ApiError && (e.status === 400 || e.status === 403 || e.status === 404)) return setView("error");
      // Tap or the API is slow or down for a moment: the webhook may still settle the order
      next();
    };
    function poll() {
      polls += 1;
      shop.getOrder(orderId).then(show, fail);
    }

    shop.reconcile(orderId).then(show, fail);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [orderId, round, router]);

  const checkAgain = () => {
    setView("checking");
    setRound((r) => r + 1);
  };

  const backToProducts = (variant: "default" | "outline") => (
    <Link href="/products" className={cn(buttonVariants({ variant, size: "lg" }))}>
      {t("backToCatalog")}
    </Link>
  );

  let icon: ReactNode;
  let headline: string;
  /** announced with the headline (inside the live region) */
  let note: ReactNode = null;
  /** inside the status card, under the headline */
  let body: ReactNode = null;
  /** cards below the status card */
  let after: ReactNode = null;
  switch (view) {
    case "checking":
      icon = <LoaderCircle className="size-7 shrink-0 animate-spin text-muted motion-reduce:animate-none" aria-hidden="true" />;
      headline = t("checking");
      break;
    case "paid":
      icon = <CircleCheck className="size-7 shrink-0 text-success" aria-hidden="true" />;
      headline = t("paid");
      body = order && (
        <>
          <OrderCode code={order.code} />
          <p className="text-[15px] text-ink-2">{t("showAtBranch")}</p>
        </>
      );
      after = order && (
        <>
          <PickupBranch locale={locale} />
          <section aria-labelledby="return-summary" className="grid gap-1 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7">
            <h2 id="return-summary" className="text-[17px] font-extrabold">
              {t("summary")}
            </h2>
            <OrderLines items={order.items} total={order.total} currency={order.currency} />
          </section>
        </>
      );
      break;
    case "review":
      icon = <Clock className="size-7 shrink-0 text-accent-ink" aria-hidden="true" />;
      headline = t("paymentReview");
      body = order && <OrderCode code={order.code} />;
      after = <PickupBranch locale={locale} />;
      break;
    case "notPaid":
      icon = <CircleX className="size-7 shrink-0 text-danger" aria-hidden="true" />;
      headline = t("notPaid");
      // no order code here: it is what the branch hands parts over for, and nothing was paid
      body = (
        <>
          <Actions>
            {/* back to the pay step of this same order, never a second order */}
            <Link href={`/checkout?order=${orderId}`} className={cn(buttonVariants({ size: "lg" }))}>
              {t("tryAgain")}
            </Link>
            {backToProducts("outline")}
          </Actions>
        </>
      );
      after = <PickupBranch locale={locale} />;
      break;
    case "expired":
      icon = <CircleAlert className="size-7 shrink-0 text-danger" aria-hidden="true" />;
      headline = t("expired");
      // the basket is still there: the checkout makes a new order from it
      body = (
        <Actions>
          <Link href="/checkout" className={cn(buttonVariants({ size: "lg" }))}>
            {t("backToCheckout")}
          </Link>
          {backToProducts("outline")}
        </Actions>
      );
      break;
    case "refunded":
      icon = <CircleAlert className="size-7 shrink-0 text-muted" aria-hidden="true" />;
      headline = t("refunded");
      body = <Actions>{backToProducts("default")}</Actions>;
      break;
    case "waiting":
      icon = <Clock className="size-7 shrink-0 text-muted" aria-hidden="true" />;
      headline = t("stillPending");
      // a second payment now could charge twice: the order settles by itself once the bank answers
      note = <p className="text-[15px] font-semibold text-ink-2">{t("dontPayAgain")}</p>;
      body = (
        <>
          {order && <OrderCode code={order.code} />}
          <Actions>
            <Button type="button" size="lg" onClick={checkAgain}>
              {t("checkAgain")}
            </Button>
            {backToProducts("outline")}
          </Actions>
        </>
      );
      after = <PickupBranch locale={locale} />;
      break;
    case "error":
      icon = <CircleAlert className="size-7 shrink-0 text-muted" aria-hidden="true" />;
      headline = t("errors.generic");
      body = (
        <Actions>
          <Button type="button" size="lg" onClick={checkAgain}>
            {t("checkAgain")}
          </Button>
          {backToProducts("outline")}
        </Actions>
      );
      break;
  }

  // one tree for every state, so the live region stays in place and its new sentence is announced
  return (
    <div className="mx-auto grid w-full max-w-xl gap-4">
      <section className="grid gap-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7">
        <div aria-live="polite" className="flex items-start gap-3">
          {icon}
          <div className="grid gap-1">
            <h1 className="text-[clamp(20px,4vw,26px)] leading-snug font-extrabold">{headline}</h1>
            {note}
          </div>
        </div>
        {body}
      </section>
      {after}
    </div>
  );
}

function OrderCode({ code }: { code: string }) {
  const t = useTranslations("Checkout");
  return (
    <div className="grid justify-items-start gap-1 rounded-[var(--radius-brand)] bg-sand px-4 py-3">
      <p className="text-[13px] font-semibold text-ink-2">{t("orderCode")}</p>
      <p dir="ltr" className="text-[clamp(30px,8vw,40px)] leading-none font-extrabold tracking-wide tabular-nums">
        {code}
      </p>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/** Where web orders are collected: the Bin Omran branch (WEB_ORDERS_BRANCH_CODE BO). */
function PickupBranch({ locale }: { locale: "ar" | "en" }) {
  const common = useTranslations("Common");
  const branch = getBranches(locale).binomran;
  return (
    <section aria-labelledby="return-branch" className="grid gap-3 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7">
      <h2 id="return-branch" className="text-[17px] font-extrabold">
        {branch.name}
      </h2>
      <div className="grid gap-1 text-[15px] text-ink-2">
        <p className="flex items-center gap-2">
          <Icon name="pin" className="size-[18px] text-muted" />
          {branch.area}
        </p>
        <p className="flex items-center gap-2">
          <Icon name="clock" className="size-[18px] text-muted" />
          {getHours(locale)}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <a href={telLink(locale, branch.id)} className={cn(buttonVariants({ variant: "outline" }))}>
          <Icon name="phone" className="size-[18px]" />
          {common("call")}
          <bdi dir="ltr" className="tabular-nums">
            {displayPhone(branch.tel)}
          </bdi>
        </a>
        <a href={branch.maps} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: "outline" }))}>
          <Icon name="nav" className="size-[18px]" />
          {common("mapLabel")}
        </a>
      </div>
    </section>
  );
}
