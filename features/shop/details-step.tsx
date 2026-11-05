"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { preconnect } from "react-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cart, type CartLine, orderMessage, useCart } from "@/features/catalog/cart";
import { newIdempotencyKey } from "@/features/showroom/idempotency";
import { ApiError } from "@/lib/api/client";
import { fieldErrors } from "@/lib/api/errors";
import type { WebOrder, WebOrderItem } from "@/lib/api/types";
import { getBranches, waLink } from "@/lib/branches";
import { hasArabic } from "@/lib/text";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import { CUSTOMER_EMAIL_MAX, EMAIL_PATTERN, normaliseQatarPhone, type PaymentMethod } from "@/shared/shop";
import { CUSTOMER_NAME_MAX, CUSTOMER_NAME_MIN, CUSTOMER_NAME_PATTERN } from "@/shared/validation";
import type { ContactDetails } from "./checkout-state";
import { OrderLines } from "./order-lines";
import { shop } from "./shop-api";
import { loadTapSdk } from "./tap-sdk";
import { useCheckoutError } from "./use-checkout-error";

export interface DetailsStepProps {
  /** what fills the form: the session's profile, or what the order was made with */
  contact: ContactDetails;
  /** a signed-in customer orders under their account's email: the field is read-only */
  signedIn: boolean;
  /** the build has Tap's public key: "pay now by card" is offered */
  cardEnabled: boolean;
  onCreated: (order: WebOrder & { key: string }) => void;
}

/** Same normalisation as the API's `CustomerName`: trimmed, inner whitespace collapsed. */
const normaliseName = (value: string) => value.trim().replace(/\s+/g, " ");

const schema = z.object({
  name: z
    .string()
    .transform(normaliseName)
    .pipe(z.string().min(CUSTOMER_NAME_MIN).max(CUSTOMER_NAME_MAX).regex(CUSTOMER_NAME_PATTERN)),
  // a Qatari mobile however it was typed, sent as E.164
  phone: z
    .string()
    .transform((value, ctx) => normaliseQatarPhone(value) ?? (ctx.addIssue({ code: "custom", message: "invalid" }), z.NEVER)),
  email: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.string().max(CUSTOMER_EMAIL_MAX).regex(EMAIL_PATTERN)),
});
type Input_ = z.input<typeof schema>;
type Values = z.output<typeof schema>;

/** "499.00" × 2 → "998.00", in halalas so the basket summary never shows a float artefact. */
const halalas = (price: string) => Math.round(Number(price) * 100);
const money = (halalasValue: number) => (halalasValue / 100).toFixed(2);

type PricedLine = CartLine & { price: string };

/** The priced lines as order lines, for the summary only: the API prices the order itself. */
function basketSummary(lines: PricedLine[]): { items: WebOrderItem[]; total: string } {
  let total = 0;
  const items = lines.map((l) => {
    const line = halalas(l.price) * l.qty;
    total += line;
    return { productId: l.id, productName: l.name, unitPrice: l.price, quantity: l.qty, lineTotal: money(line), thumbUrl: l.thumbUrl };
  });
  return { items, total: money(total) };
}

/**
 * Step 1: name, mobile and email over the basket, and how to pay. A card order is created unpaid so the
 * server total is shown before the card; an order to pay at the branch is placed there and then. Only priced
 * lines are ordered; the unpriced ones stay in the basket, for WhatsApp.
 */
export function DetailsStep({ contact, signedIn, cardEnabled, onCreated }: DetailsStepProps) {
  const t = useTranslations("Checkout");
  const tc = useTranslations("Cart");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const message = useCheckoutError();
  const basket = useCart();
  const lines = basket.filter((l): l is PricedLine => l.price !== null);
  const unpriced = basket.filter((l) => l.price === null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(cardEnabled ? "card" : "branch");
  /** `checkout_start` counts the first press of this visit to the step, not every retry */
  const [started, setStarted] = useState(false);
  const form = useForm<Input_, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: contact.name, phone: contact.phone, email: contact.email },
  });
  const { errors, isSubmitting } = form.formState;
  const summary = basketSummary(lines);

  // Tap's card form may come next: fetch its script while the customer types, so the card shows sooner
  useEffect(() => {
    if (!cardEnabled) return;
    preconnect("https://sdk.tap.company");
    loadTapSdk().catch(() => {
      /* the pay step loads it again and says so if it still fails */
    });
  }, [cardEnabled]);

  const submit = form.handleSubmit(async ({ name, phone, email }) => {
    if (lines.length === 0) return;
    setError(null);
    if (!started) {
      setStarted(true);
      track("checkout_start");
    }
    try {
      // only ids and quantities: the server prices the order, never the browser
      const items = lines.map((l) => ({ productId: l.id, quantity: l.qty }));
      onCreated(await shop.createOrder({ items, name, phone, email, paymentMethod: method, locale }, newIdempotencyKey()));
    } catch (e) {
      const removed = e instanceof ApiError && e.code === "PRODUCT_UNAVAILABLE" ? (e.productIds ?? []).filter((id) => lines.some((l) => l.id === id)) : [];
      if (removed.length > 0) {
        removed.forEach((id) => cart.setQty(id, 0));
        setError(t("unavailableRemoved", { count: removed.length }));
        return;
      }
      const fields = fieldErrors(e);
      if (fields.name) form.setError("name", { message: "invalid" }, { shouldFocus: true });
      if (fields.phone) form.setError("phone", { message: "invalid" }, { shouldFocus: !fields.name });
      if (fields.email) form.setError("email", { message: "invalid" }, { shouldFocus: !fields.name && !fields.phone });
      if (!fields.name && !fields.phone && !fields.email) setError(message(e));
    }
  });

  const nameInvalid = Boolean(errors.name);
  const phoneInvalid = Boolean(errors.phone);
  const emailInvalid = Boolean(errors.email);
  const branch = getBranches(locale).binomran.name;
  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <section aria-labelledby="checkout-summary" className="grid gap-1">
        <h2 id="checkout-summary" className="text-[17px] font-extrabold">
          {t("summary")}
        </h2>
        <OrderLines items={summary.items} total={summary.total} currency="QAR" />
      </section>

      {unpriced.length > 0 && (
        <section aria-labelledby="checkout-unpriced" className="grid gap-2 rounded-[var(--radius-brand)] bg-sand px-4 py-3">
          <h3 id="checkout-unpriced" className="text-[15px] font-bold text-ink-2">
            {t("unpricedExcluded")}
          </h3>
          <ul className="grid gap-1 text-[14px]">
            {unpriced.map((l) => (
              <li key={l.id} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-start font-semibold">
                  <bdi dir={hasArabic(l.name) ? "rtl" : "ltr"}>{l.name}</bdi>
                </span>
                <span dir="ltr" className="shrink-0 text-ink-2 tabular-nums">
                  ×{l.qty}
                </span>
              </li>
            ))}
          </ul>
          <a
            href={waLink(locale, "binomran", orderMessage(unpriced, locale))}
            target="_blank"
            rel="noopener"
            data-track="whatsapp_order"
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-brand)] border-[1.5px] border-wa/50 bg-surface px-4 text-[14px] font-bold text-ink hover:border-wa hover:bg-wa/5"
          >
            <Icon name="wa" className="size-5 text-wa" />
            {tc("checkout", { branch: getBranches(locale).binomran.short })}
          </a>
        </section>
      )}

      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="checkout-name">{t("nameLabel")}</Label>
          <Input
            id="checkout-name"
            autoComplete="name"
            autoCapitalize="words"
            dir="auto"
            maxLength={CUSTOMER_NAME_MAX}
            aria-invalid={nameInvalid || undefined}
            aria-describedby={nameInvalid ? "checkout-name-invalid" : undefined}
            className="text-start"
            {...form.register("name")}
          />
          {nameInvalid && (
            <p id="checkout-name-invalid" className="text-[13px] font-semibold text-danger">
              {t("nameInvalid")}
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="checkout-phone">{t("phoneLabel")}</Label>
          <Input
            id="checkout-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="5512 3456"
            aria-invalid={phoneInvalid || undefined}
            aria-describedby={phoneInvalid ? "checkout-phone-hint checkout-phone-invalid" : "checkout-phone-hint"}
            className="text-start"
            {...form.register("phone")}
          />
          <p id="checkout-phone-hint" className="text-[13px] text-ink-2">
            {t("phoneHint")}
          </p>
          {phoneInvalid && (
            <p id="checkout-phone-invalid" className="text-[13px] font-semibold text-danger">
              {t("phoneInvalid")}
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="checkout-email">{t("emailLabel")}</Label>
          <Input
            id="checkout-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            dir="ltr"
            readOnly={signedIn}
            maxLength={CUSTOMER_EMAIL_MAX}
            aria-invalid={emailInvalid || undefined}
            aria-describedby={emailInvalid ? "checkout-email-hint checkout-email-invalid" : "checkout-email-hint"}
            className={cn("text-start", signedIn && "bg-sand text-ink-2")}
            {...form.register("email")}
          />
          <p id="checkout-email-hint" className="text-[13px] text-ink-2">
            {t(signedIn ? "emailAccountHint" : "emailHint")}
          </p>
          {emailInvalid && (
            <p id="checkout-email-invalid" className="text-[13px] font-semibold text-danger">
              {t("emailInvalid")}
            </p>
          )}
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[17px] font-extrabold">{t("payTitle")}</legend>
        {cardEnabled ? (
          (["card", "branch"] as const).map((value) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-[var(--radius-brand)] border-[1.5px] border-line p-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-ink",
                method === value && "border-accent bg-accent/5",
              )}
            >
              <input
                type="radio"
                name="checkout-payment"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
                className="mt-1 size-4 accent-[var(--color-accent)]"
              />
              <span className="grid gap-0.5">
                <b className="text-[15px]">{t(value === "card" ? "payCard" : "payBranch")}</b>
                <small className="text-[13px] text-ink-2">{value === "card" ? t("payCardHint") : t("payBranchHint", { branch })}</small>
              </span>
            </label>
          ))
        ) : (
          <div className="grid gap-0.5 rounded-[var(--radius-brand)] border-[1.5px] border-line p-3.5">
            <b className="text-[15px]">{t("payBranch")}</b>
            <small className="text-[13px] text-ink-2">{t("payBranchHint", { branch })}</small>
          </div>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="rounded-[var(--radius-brand)] bg-danger-soft px-3 py-2.5 text-[15px] font-semibold text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isSubmitting || lines.length === 0}>
        {method === "card" ? t("continueToPay") : t("placeOrder")}
      </Button>
    </form>
  );
}
