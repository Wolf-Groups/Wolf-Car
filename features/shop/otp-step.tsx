"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import type { CustomerProfile } from "@/lib/api/types";
import { localQatarNumber, OTP_LENGTH, OTP_RESEND_SECONDS } from "@/shared/shop";
import { shop } from "./shop-api";
import { useCheckoutError } from "./use-checkout-error";

export interface OtpStepProps {
  phone: string;
  /** epoch ms when "Resend" becomes available; null means at once */
  resendAt: number | null;
  onVerified: (customer: CustomerProfile) => void;
  onChangePhone: () => void;
  onResent: (resendAt: number) => void;
  /** development only: the page passes it when the API echoed the code */
  devCode?: string;
}

/** "+97455123456" → "+974 5512 3456" */
const display = (e164: string) => {
  const local = localQatarNumber(e164);
  return `+974 ${local.slice(0, 4)} ${local.slice(4)}`;
};

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

/** Step 2: the six-digit code, auto-submitted when full, with resend countdown and "change number". */
export function OtpStep({ phone, resendAt, devCode, onVerified, onChangePhone, onResent }: OtpStepProps) {
  const t = useTranslations("Checkout");
  const message = useCheckoutError();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const seconds = useSecondsLeft(resendAt);

  const verify = async (value: string) => {
    if (working.current) return;
    working.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await shop.verifyOtp(phone, value);
      onVerified(res.customer);
    } catch (err) {
      setError(message(err));
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
      await shop.sendOtp(phone);
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
        {t("codeSentTo", { phone: `\u2066${display(phone)}\u2069` })}
      </p>
      {/* digits run left-to-right, but the group sits at the start of the line like the other fields */}
      <div className="flex">
        <div dir="ltr">
          <InputOTP
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
          onClick={onChangePhone}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t("changeNumber")}
        </button>
      </div>
    </div>
  );
}
