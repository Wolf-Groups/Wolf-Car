"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cart, type CartLine, useCart } from "@/features/catalog/cart";
import { newIdempotencyKey } from "@/features/showroom/idempotency";
import { ApiError } from "@/lib/api/client";
import { fieldErrors } from "@/lib/api/errors";
import type { CustomerProfile, WebOrder, WebOrderItem } from "@/lib/api/types";
import { track } from "@/lib/track";
import { CUSTOMER_EMAIL_MAX, EMAIL_PATTERN } from "@/shared/shop";
import { CUSTOMER_NAME_MAX, CUSTOMER_NAME_MIN, CUSTOMER_NAME_PATTERN } from "@/shared/validation";
import { OrderLines } from "./order-lines";
import { shop } from "./shop-api";
import { useCheckoutError } from "./use-checkout-error";

export interface DetailsStepProps {
  customer: CustomerProfile;
  onCreated: (order: WebOrder) => void;
}

/** Same normalisation as the API's `CustomerName`: trimmed, inner whitespace collapsed. */
const normaliseName = (value: string) => value.trim().replace(/\s+/g, " ");

const schema = z.object({
  name: z
    .string()
    .transform(normaliseName)
    .pipe(z.string().min(CUSTOMER_NAME_MIN).max(CUSTOMER_NAME_MAX).regex(CUSTOMER_NAME_PATTERN)),
  email: z.string().trim().max(CUSTOMER_EMAIL_MAX).regex(EMAIL_PATTERN),
});
type Input_ = z.input<typeof schema>;
type Values = z.output<typeof schema>;

/** "499.00" × 2 → "998.00", in halalas so the basket summary never shows a float artefact. */
const halalas = (price: string) => Math.round(Number(price) * 100);
const money = (halalasValue: number) => (halalasValue / 100).toFixed(2);

/** The basket as order lines, for the summary only: the API prices the order itself. */
function basketSummary(lines: CartLine[]): { items: WebOrderItem[]; total: string } {
  let total = 0;
  const items = lines.map((l) => {
    const line = l.price === null ? null : halalas(l.price) * l.qty;
    total += line ?? 0;
    return {
      productId: l.id,
      productName: l.name,
      unitPrice: l.price ?? "",
      quantity: l.qty,
      lineTotal: line === null ? "" : money(line),
      thumbUrl: l.thumbUrl,
    };
  });
  return { items, total: money(total) };
}

/** Step 3: name and email over the basket; creates the unpaid order so the server total is shown before the card. */
export function DetailsStep({ customer, onCreated }: DetailsStepProps) {
  const t = useTranslations("Checkout");
  const message = useCheckoutError();
  const lines = useCart();
  const [error, setError] = useState<string | null>(null);
  /** `checkout_start` counts the first press of this visit to the step, not every retry */
  const [started, setStarted] = useState(false);
  const form = useForm<Input_, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: customer.name ?? "", email: customer.email ?? "" },
  });
  const { errors, isSubmitting } = form.formState;
  const summary = basketSummary(lines);

  const submit = form.handleSubmit(async ({ name, email }) => {
    if (lines.length === 0) return;
    setError(null);
    if (!started) {
      setStarted(true);
      track("checkout_start");
    }
    try {
      // only ids and quantities: the server prices the order, never the browser
      const items = lines.map((l) => ({ productId: l.id, quantity: l.qty }));
      onCreated(await shop.createOrder({ items, name, email }, newIdempotencyKey()));
    } catch (e) {
      const removed = e instanceof ApiError && e.code === "PRODUCT_UNAVAILABLE" ? (e.productIds ?? []).filter((id) => lines.some((l) => l.id === id)) : [];
      if (removed.length > 0) {
        removed.forEach((id) => cart.setQty(id, 0));
        setError(t("unavailableRemoved", { count: removed.length }));
        return;
      }
      const fields = fieldErrors(e);
      if (fields.name) form.setError("name", { message: "invalid" }, { shouldFocus: true });
      if (fields.email) form.setError("email", { message: "invalid" }, { shouldFocus: !fields.name });
      if (!fields.name && !fields.email) setError(message(e));
    }
  });

  const nameInvalid = Boolean(errors.name);
  const emailInvalid = Boolean(errors.email);
  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <section aria-labelledby="checkout-summary" className="grid gap-1">
        <h2 id="checkout-summary" className="text-[17px] font-extrabold">
          {t("summary")}
        </h2>
        <OrderLines items={summary.items} total={summary.total} currency="QAR" />
      </section>

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
          <Label htmlFor="checkout-email">{t("emailLabel")}</Label>
          <Input
            id="checkout-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            dir="ltr"
            maxLength={CUSTOMER_EMAIL_MAX}
            aria-invalid={emailInvalid || undefined}
            aria-describedby={emailInvalid ? "checkout-email-hint checkout-email-invalid" : "checkout-email-hint"}
            className="text-start"
            {...form.register("email")}
          />
          <p id="checkout-email-hint" className="text-[13px] text-ink-2">
            {t("emailHint")}
          </p>
          {emailInvalid && (
            <p id="checkout-email-invalid" className="text-[13px] font-semibold text-danger">
              {t("emailInvalid")}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-brand)] bg-danger-soft px-3 py-2.5 text-[15px] font-semibold text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isSubmitting || lines.length === 0}>
        {t("continueToPay")}
      </Button>
    </form>
  );
}
