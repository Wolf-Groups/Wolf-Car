"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import type { CustomerProfile } from "@/lib/api/types";
import { OTP_LENGTH, OTP_RESEND_SECONDS } from "@/shared/shop";
import { shop } from "./shop-api";
import { useCheckoutError } from "./use-checkout-error";

export interface CodeStepProps {
  email: string;
  /** epoch ms when "Resend" becomes available; null means at once */
  resendAt: number | null;
  onVerified: (customer: CustomerProfile) => void;
  onChangeEmail: () => void;
  onResent: (resendAt: number) => void;
  /** development only: the page passes it when the API echoed the code */
  devCode?: string;
}

function useSecondsLeft(until: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until === null) return;
    const sync = () => setNow(Date.now());
    const first = setTimeout(sync, 0);
    const id = setInterval(sync, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/** Signing in, step 2: the six-digit code from the email, auto-submitted when full, with resend countdown and "change email". */
export function CodeStep({ email, resendAt, devCode, onVerified, onChangeEmail, onResent }: CodeStepProps) {
  const t = useTranslations("Checkout");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const message = useCheckoutError();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const seconds = useSecondsLeft(resendAt);

  // the input is disabled while a code is checked, which takes focus away: give it back after a refusal
  useEffect(() => {
    if (!busy && error) input.current?.focus();
  }, [busy, error]);

  const verify = async (value: string) => {
    if (working.current) return;
    working.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await shop.verifyCode(email, value);
      onVerified(res.customer);
    } catch (err) {
      setError(message(err));
      // typed again from the first box: kept digits would turn the next keystroke into another wrong try (5 per code)
      setCode("");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const resend = async () => {
    if (working.current) return;
    working.current = true;
    setError(null);
    setBusy(true);
    try {
      await shop.sendCode(email, locale);
      setCode("");
      onResent(Date.now() + OTP_RESEND_SECONDS * 1000);
    } catch (err) {
      setError(message(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <p className="text-[15px] text-ink-2">
        {t("codeSentTo", { email: `\u2066${email}\u2069` })}
      </p>
      {/* digits run left-to-right, but the group sits at the start of the line like the other fields */}
      <div className="flex">
        <div dir="ltr">
          <InputOTP
            ref={input}
            maxLength={OTP_LENGTH}
            value={code}
            onChange={(next) => {
              setCode(next);
              if (next.length === OTP_LENGTH) void verify(next);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={t("codeLabel")}
            aria-invalid={error ? true : undefined}
            disabled={busy}
          >
            <InputOTPGroup>
              {Array.from({ length: OTP_LENGTH }, (_, i) => (
                <InputOTPSlot key={i} index={i} className="size-12 text-lg font-bold" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {devCode && <p className="text-[13px] text-muted">{t("devCode", { code: devCode })}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button type="button" variant="outline" disabled={seconds > 0 || busy} onClick={resend} className="min-h-11">
          {seconds > 0 ? t("resendIn", { seconds }) : t("resend")}
        </Button>
        <button
          type="button"
          onClick={onChangeEmail}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t("changeEmail")}
        </button>
      </div>
    </div>
  );
}
