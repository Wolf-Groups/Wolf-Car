"use client";

import { Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { OtpStep } from "@/features/shop/otp-step";
import { PhoneStep } from "@/features/shop/phone-step";
import { OTP_RESEND_SECONDS } from "@/shared/shop";

/** The code the API echoes in development; read once, so a production build never shows it. */
const SHOW_DEV_CODE = process.env.NODE_ENV !== "production";

export interface SignInProps {
  /** called once the code is verified and the session cookie is set */
  onSignedIn: () => void | Promise<void>;
}

/** The checkout's sign-in (phone, then the six-digit code) on its own, for the account pages. */
export function SignIn({ onSignedIn }: SignInProps) {
  const t = useTranslations("Account");
  const [phone, setPhone] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [devCode, setDevCode] = useState<string>();

  return (
    <section className="mx-auto grid w-full max-w-md gap-5 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7">
      <div className="grid gap-3">
        <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-accent/10 text-accent-ink">
          <Smartphone className="size-6" />
        </span>
        <div className="grid gap-1">
          <h2 className="text-xl font-extrabold">{t("signInTitle")}</h2>
          <p className="text-[15px] text-ink-2">{t("signInIntro")}</p>
        </div>
      </div>
      {phone === null ? (
        <PhoneStep
          onSent={(sent, code) => {
            setPhone(sent);
            setResendAt(Date.now() + OTP_RESEND_SECONDS * 1000);
            setDevCode(SHOW_DEV_CODE ? code : undefined);
          }}
        />
      ) : (
        <OtpStep
          phone={phone}
          resendAt={resendAt}
          devCode={devCode}
          onVerified={() => void onSignedIn()}
          onChangePhone={() => {
            setPhone(null);
            setDevCode(undefined);
          }}
          onResent={setResendAt}
        />
      )}
    </section>
  );
}
