"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useCart } from "@/features/catalog/cart";
import { Link } from "@/i18n/navigation";
import type { WebOrder } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { localQatarNumber } from "@/shared/shop";
import { initialState, reduce, type Step } from "./checkout-state";
import { DetailsStep } from "./details-step";
import { OtpStep } from "./otp-step";
import { PayStep } from "./pay-step";
import { PhoneStep } from "./phone-step";
import { ORDER_ID_PATTERN, shop } from "./shop-api";
import { type CustomerSession, useCustomer } from "./use-customer";

export interface CheckoutProps {
  /** NEXT_PUBLIC_TAP_PUBLIC_KEY */
  publicKey: string;
}

/** The code the API echoes in development; read once, so a production build never shows it. */
const SHOW_DEV_CODE = process.env.NODE_ENV !== "production";

const STEPS = ["phone", "code", "details", "pay"] as const satisfies readonly Step[];
const STEP_LABEL = { phone: "stepPhone", code: "stepCode", details: "stepDetails", pay: "stepPay" } as const;

/** "+97455123456" → "+974 5512 3456" */
const displayPhone = (e164: string) => {
  const local = localQatarNumber(e164);
  return `+974 ${local.slice(0, 4)} ${local.slice(4)}`;
};

/**
 * An order "Try another card" may take back to the pay step: still open and unpaid,
 * not past its expiry, and no capture on it (money already taken is for the branch to sort out).
 */
function resumable(order: WebOrder): boolean {
  return (
    order.status === "PENDING" &&
    order.paymentStatus === "PENDING" &&
    order.lastPayment?.status !== "CAPTURED" &&
    (order.expiresAt === null || Date.parse(order.expiresAt) > Date.now())
  );
}

/** The whole checkout: `useReducer(reduce, initialState)` over the four steps, or `empty` with a link to the catalogue. */
export function Checkout({ publicKey }: CheckoutProps) {
  const t = useTranslations("Checkout");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const lines = useCart();
  const session = useCustomer();
  const [state, dispatch] = useReducer(reduce, initialState);
  const [devCode, setDevCode] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);

  // "Try another card" on the return page: /checkout?order=<id> picks the same order up at the pay step
  const orderParam = useSearchParams().get("order");
  const resumeId = orderParam !== null && ORDER_ID_PATTERN.test(orderParam) ? orderParam : null;
  const [resumeSettled, setResumeSettled] = useState(false);

  // the remembered session decides the first step, in the same render it arrives (no flash of the phone step)
  const [seen, setSeen] = useState<CustomerSession["status"]>("loading");
  if (session.status !== seen) {
    setSeen(session.status);
    if (session.status === "signed-in" && session.customer) dispatch({ type: "SESSION_FOUND", customer: session.customer });
    else if (session.status === "anonymous") dispatch({ type: "NO_SESSION" });
  }

  useEffect(() => {
    if (session.status !== "signed-in" || resumeId === null) return;
    let live = true;
    shop
      .getOrder(resumeId)
      .then((order) => {
        if (live && resumable(order)) dispatch({ type: "ORDER_CREATED", order });
      })
      // gone, or not this customer's: the details step starts a new order
      .catch(() => undefined)
      .finally(() => {
        if (live) setResumeSettled(true);
      });
    return () => {
      live = false;
    };
  }, [session.status, resumeId]);

  const signOut = async () => {
    setSigningOut(true);
    await session.signOut();
    // a customer who signed in on this page never had a remembered session to lose: reset the steps here
    dispatch({ type: "NO_SESSION" });
    setDevCode(undefined);
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

  const booting = session.status === "loading" || (session.status === "signed-in" && resumeId !== null && !resumeSettled);
  if (booting) {
    return <div aria-busy="true" className="h-56 animate-pulse rounded-[var(--radius-brand-lg)] border border-line bg-surface" />;
  }

  // the pay step stays: its order already holds the lines, whatever happens to the basket meanwhile
  if (lines.length === 0 && state.step !== "pay") {
    return (
      <div className="grid justify-items-start gap-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7">
        <p className="text-[17px] text-ink-2">{t("empty")}</p>
        <Link href="/products" className={cn(buttonVariants({ size: "lg" }))}>
          {t("backToCatalog")}
        </Link>
      </div>
    );
  }

  const current = STEPS.indexOf(state.step);
  const customer = state.step === "details" || state.step === "pay" ? state.customer : null;

  return (
    <div className="grid gap-5">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((step, i) => (
          <li key={step} aria-current={i === current ? "step" : undefined} className="grid gap-1.5">
            <span aria-hidden="true" className={cn("h-1 rounded-full", i <= current ? "bg-accent" : "bg-line")} />
            <span className={cn("text-[13px] leading-tight", i === current ? "font-bold text-ink" : "text-muted")}>{t(STEP_LABEL[step])}</span>
          </li>
        ))}
      </ol>

      {customer && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface px-4 py-1.5 text-[15px] text-ink-2">
          <span>{t("signedInAs", { phone: `⁦${displayPhone(customer.phone)}⁩` })}</span>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
          >
            {t("signOut")}
          </button>
        </div>
      )}

      <div
        ref={stepBox}
        tabIndex={-1}
        role="group"
        aria-label={t(STEP_LABEL[state.step])}
        className="rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 outline-none md:p-7"
      >
        {state.step === "phone" && (
          <PhoneStep
            onSent={(phone, code) => {
              setDevCode(SHOW_DEV_CODE ? code : undefined);
              dispatch({ type: "OTP_SENT", phone, now: Date.now() });
            }}
          />
        )}
        {state.step === "code" && (
          <OtpStep
            phone={state.phone}
            resendAt={state.resendAt}
            devCode={SHOW_DEV_CODE ? devCode : undefined}
            onVerified={(verified) => {
              setDevCode(undefined);
              dispatch({ type: "VERIFIED", customer: verified });
            }}
            onChangePhone={() => {
              setDevCode(undefined);
              dispatch({ type: "CHANGE_PHONE" });
            }}
            onResent={() => {
              // a new code was sent; the one on screen is no longer it
              setDevCode(undefined);
              dispatch({ type: "OTP_SENT", phone: state.phone, now: Date.now() });
            }}
          />
        )}
        {state.step === "details" && state.customer && (
          <DetailsStep customer={state.customer} onCreated={(order) => dispatch({ type: "ORDER_CREATED", order })} />
        )}
        {state.step === "pay" && state.order && (
          <PayStep order={state.order} publicKey={publicKey} locale={locale} onBack={() => dispatch({ type: "BACK_TO_DETAILS" })} />
        )}
      </div>
    </div>
  );
}
