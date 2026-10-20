"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normaliseQatarPhone } from "@/shared/shop";
import { shop } from "./shop-api";
import { useCheckoutError } from "./use-checkout-error";

export interface PhoneStepProps {
  /** the E.164 phone the code went to, plus the code itself when the API is in development mode */
  onSent: (phone: string, devCode?: string) => void;
}

/** Step 1: one phone input, normalised live through `normaliseQatarPhone`; sends the code. */
export function PhoneStep({ onSent }: PhoneStepProps) {
  const t = useTranslations("Checkout");
  const message = useCheckoutError();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phone = normaliseQatarPhone(value);
  const invalid = touched && value.trim() !== "" && phone === null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!phone || busy) return;
    setError(null);
    setBusy(true);
    try {
      const sent = await shop.sendOtp(phone);
      onSent(phone, sent.devCode);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="checkout-phone">{t("phoneLabel")}</Label>
        <Input
          id="checkout-phone"
          type="tel"
          inputMode="tel"
          dir="ltr"
          autoComplete="tel"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "checkout-phone-hint checkout-phone-invalid" : "checkout-phone-hint"}
          placeholder="5512 3456"
          className="text-start"
        />
        <p id="checkout-phone-hint" className="text-[13px] text-ink-2">
          {t("phoneHint")}
        </p>
        {invalid && (
          <p id="checkout-phone-invalid" className="text-[13px] font-semibold text-danger">
            {t("phoneInvalid")}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!phone || busy} className="min-h-11">
        {t("sendCode")}
      </Button>
    </form>
  );
}
