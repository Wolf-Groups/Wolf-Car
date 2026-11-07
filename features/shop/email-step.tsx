"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CUSTOMER_EMAIL_MAX, EMAIL_PATTERN } from "@/shared/shop";
import { shop } from "./shop-api";
import { useCheckoutError } from "./use-checkout-error";

export interface EmailStepProps {
  /** the lower-case address the code went to, plus the code itself when the API is in development mode */
  onSent: (email: string, devCode?: string) => void;
}

/** Signing in, step 1: one email field; emails a six-digit code in the site's language. */
export function EmailStep({ onSent }: EmailStepProps) {
  const t = useTranslations("Checkout");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const message = useCheckoutError();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = value.trim().toLowerCase();
  const valid = email.length <= CUSTOMER_EMAIL_MAX && EMAIL_PATTERN.test(email);
  const invalid = touched && email !== "" && !valid;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setError(null);
    setBusy(true);
    try {
      const sent = await shop.sendCode(email, locale);
      onSent(email, sent.devCode);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="sign-in-email">{t("emailLabel")}</Label>
        <Input
          id="sign-in-email"
          type="email"
          inputMode="email"
          dir="ltr"
          autoComplete="email"
          spellCheck={false}
          maxLength={CUSTOMER_EMAIL_MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "sign-in-email-hint sign-in-email-invalid" : "sign-in-email-hint"}
          placeholder="name@example.com"
          className="text-start"
        />
        <p id="sign-in-email-hint" className="text-[13px] text-ink-2">
          {t("signInEmailHint")}
        </p>
        {invalid && (
          <p id="sign-in-email-invalid" className="text-[13px] font-semibold text-danger">
            {t("emailInvalid")}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!valid || busy} className="min-h-11">
        {t("sendCode")}
      </Button>
    </form>
  );
}
