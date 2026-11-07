"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { SignIn } from "@/features/account/sign-in";
import { type CartLine, useCart } from "@/features/catalog/cart";
import { Link, useRouter } from "@/i18n/navigation";
import type { WebOrder } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ORDER_KEY_PATTERN } from "@/shared/shop";
import { ApiError } from "@/lib/api/client";
import { initialState, paidOrHeld, reduce, resumable, type Step } from "./checkout-state";
import { DetailsStep } from "./details-step";
import { PayStep } from "./pay-step";
import { ORDER_ID_PATTERN, orderPath, shop } from "./shop-api";
import { type CustomerSession, useCustomer } from "./use-customer";
import { WhatsAppOrderLink } from "./whatsapp-order-link";

export interface CheckoutProps {
  /** NEXT_PUBLIC_TAP_PUBLIC_KEY (card-checkout.ts); empty: no card payment, orders are paid at the branch */
  publicKey: string;
}

const STEPS = ["details", "pay"] as const satisfies readonly Step[];
const STEP_LABEL = { details: "stepDetails", pay: "stepPay" } as const;

/**
 * Keeps the open card order in the address (?order=&key=), so a reload, Forward, or Back from Tap's
 * 3-D Secure page reopens its pay step through the resume below instead of starting a new order; the
 * key opens it for a guest. The browser's own history API: Next syncs useSearchParams without a
 * navigation, so the pay step and Tap's form are not drawn again.
 */
function showOrderInUrl(order: { id: string; key: string | null } | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete("order");
  url.searchParams.delete("key");
  if (order) {
    url.searchParams.set("order", order.id);
    if (order.key) url.searchParams.set("key", order.key);
  }
  window.history.replaceState(null, "", url);
}

/**
 * The order to resume as it stands now. A charge still marked INITIATED may have been decided at the
 * bank since the customer left its page (Back from 3-D Secure): Tap is asked before Pay is offered
 * again, and if it cannot be asked, our own record stands.
 */
async function currentOrder(id: string, key: string | null): Promise<WebOrder> {
  const order = await shop.getOrder(id, key);
  if (order.lastPayment?.status !== "INITIATED") return order;
  return shop.reconcile(id, key).catch(() => order);
}

/**
 * A message in place of the steps, with the way back to the products and,
 * for a basket, the way to order it on WhatsApp instead.
 */
function CheckoutNotice({ message, whatsapp = [] }: { message: string; whatsapp?: CartLine[] }) {
  const t = useTranslations("Checkout");
  return (
    <div className="grid justify-items-start gap-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7">
      <p className="text-[17px] text-ink-2">{message}</p>
      <div className="flex flex-wrap gap-3">
        {whatsapp.length > 0 && <WhatsAppOrderLink lines={whatsapp} />}
        <Link href="/products" className={cn(buttonVariants({ variant: whatsapp.length > 0 ? "outline" : "default", size: "lg" }))}>
          {t("backToCatalog")}
        </Link>
      </div>
    </div>
  );
}

const linkButton =
  "inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";

/**
 * The checkout: `useReducer(reduce, initialState)` over details → pay, or `empty` with a link to the
 * catalogue. Nobody has to sign in: a session (or signing in here) only fills the details in. An order
 * to pay at the branch goes straight from the details to its thank-you page.
 */
export function Checkout({ publicKey }: CheckoutProps) {
  const t = useTranslations("Checkout");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const lines = useCart();
  const session = useCustomer();
  const router = useRouter();
  const cardEnabled = publicKey !== "";
  const [state, dispatch] = useReducer(reduce, initialState);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // "Try another card" on the return page, a reload or Back from the bank: /checkout?order=<id>&key=<key>
  const params = useSearchParams();
  const orderParam = params.get("order");
  const keyParam = params.get("key");
  const resumeId = orderParam !== null && ORDER_ID_PATTERN.test(orderParam) ? orderParam : null;
  const resumeKey = keyParam !== null && ORDER_KEY_PATTERN.test(keyParam) ? keyParam : null;
  /** the order in the address was looked at (resumed, or found not resumable) */
  const [resumed, setResumed] = useState<string | null>(null);
  /** the pay step was opened by a resume, not by "Continue": it brings the card into view */
  const [payResumed, setPayResumed] = useState(false);

  // the remembered session fills the details in the same render it arrives (no flash of empty fields)
  const [seen, setSeen] = useState<CustomerSession["status"]>("loading");
  if (session.status !== seen) {
    setSeen(session.status);
    if (session.status === "signed-in" && session.customer) dispatch({ type: "SESSION_FOUND", customer: session.customer });
  }

  // the order in the address is the one on screen (just created here): nothing to fetch, and fetching would redraw the card
  const showing = state.step === "pay" && state.order?.id === resumeId;
  // a guest's order opens with its key; a signed-in customer's own with the cookie
  const resuming = resumeId !== null && resumed !== resumeId && !showing && session.status !== "loading" && (resumeKey !== null || session.status === "signed-in");

  useEffect(() => {
    if (!resuming || resumeId === null) return;
    let live = true;
    currentOrder(resumeId, resumeKey).then(
      (order) => {
        if (!live) return;
        // paid, money taken and held, or to pay at the branch: its return page says so, and no new checkout starts
        if (paidOrHeld(order) || order.paymentMethod === "branch") return router.replace(orderPath("/checkout/return", order.id, resumeKey));
        if (resumable(order)) {
          setPayResumed(true);
          dispatch({ type: "ORDER_CREATED", order, key: resumeKey });
        } else showOrderInUrl(null);
        setResumed(resumeId);
      },
      (e: unknown) => {
        if (!live) return;
        // gone, not this customer's, or a wrong key: the details step starts a new order. Any other failure (offline,
        // a 5xx) keeps the order in the address, so a reload tries again instead of starting a second one.
        if (e instanceof ApiError && (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404)) showOrderInUrl(null);
        setResumed(resumeId);
      },
    );
    return () => {
      live = false;
    };
  }, [resuming, resumeId, resumeKey, router]);

  const signOut = async () => {
    setSigningOut(true);
    await session.signOut();
    dispatch({ type: "SIGNED_OUT" });
    setSigningOut(false);
  };

  // a new step replaces the button that was pressed: keyboard and screen-reader focus follows to the step
  const stepBox = useRef<HTMLDivElement>(null);
  const shownStep = useRef<Step | null>(null);
  useEffect(() => {
    if (!stepBox.current) return;
    if (shownStep.current !== null && shownStep.current !== state.step) stepBox.current.focus();
    shownStep.current = state.step;
  });

  const booting = session.status === "loading" || resuming;
  if (booting) {
    return <div aria-busy="true" className="h-56 animate-pulse rounded-[var(--radius-brand-lg)] border border-line bg-surface" />;
  }

  // the pay step stays: its order already holds the lines, whatever happens to the basket meanwhile
  if (lines.length === 0 && state.step !== "pay") return <CheckoutNotice message={t("empty")} />;

  // unpriced lines are never ordered online: a basket of only those has nothing to order here
  if (!lines.some((l) => l.price !== null) && state.step !== "pay") return <CheckoutNotice message={t("noPricedItems")} whatsapp={lines} />;

  const current = STEPS.indexOf(state.step);
  const signedIn = state.customer;

  return (
    <div className="grid gap-5">
      {cardEnabled && (
        <ol className="grid grid-cols-2 gap-2">
          {STEPS.map((step, i) => (
            <li key={step} aria-current={i === current ? "step" : undefined} className="grid gap-1.5">
              <span aria-hidden="true" className={cn("h-1 rounded-full", i <= current ? "bg-accent" : "bg-line")} />
              <span className={cn("text-[13px] leading-tight", i === current ? "font-bold text-ink" : "text-muted")}>{t(STEP_LABEL[step])}</span>
            </li>
          ))}
        </ol>
      )}

      {state.step === "details" && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface px-4 py-1.5 text-[15px] text-ink-2">
          {signedIn ? (
            <>
              <span>{t("signedInAs", { email: `⁦${signedIn.email}⁩` })}</span>
              <button type="button" onClick={signOut} disabled={signingOut} className={linkButton}>
                {t("signOut")}
              </button>
            </>
          ) : signingIn ? (
            <button type="button" onClick={() => setSigningIn(false)} className={linkButton}>
              {t("continueAsGuest")}
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-x-2">
              {t("haveAccount")}
              <button type="button" onClick={() => setSigningIn(true)} className={linkButton}>
                {t("signIn")}
              </button>
            </span>
          )}
        </div>
      )}

      <div
        ref={stepBox}
        tabIndex={-1}
        role="group"
        aria-label={t(STEP_LABEL[state.step])}
        className="rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 outline-none md:p-7"
      >
        {state.step === "details" && !signedIn && signingIn && (
          <SignIn
            embedded
            onSignedIn={async () => {
              setSigningIn(false);
              await session.refresh();
            }}
          />
        )}
        {state.step === "details" && (signedIn || !signingIn) && (
          <DetailsStep
            // a new contact (signed in or out here) fills the form afresh
            key={signedIn?.email ?? "guest"}
            contact={state.contact}
            signedIn={signedIn !== null}
            cardEnabled={cardEnabled}
            onCreated={(order) => {
              if (order.paymentMethod === "branch") return router.push(orderPath("/checkout/return", order.id, order.key));
              setPayResumed(false);
              // settled for this order: the ?order= written next never sends it through the resume
              setResumed(order.id);
              dispatch({ type: "ORDER_CREATED", order, key: order.key });
              showOrderInUrl({ id: order.id, key: order.key });
            }}
          />
        )}
        {state.step === "pay" && state.order && (
          <PayStep
            order={state.order}
            orderKey={state.key}
            publicKey={publicKey}
            locale={locale}
            resumed={payResumed}
            onBack={() => {
              dispatch({ type: "BACK_TO_DETAILS" });
              showOrderInUrl(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
