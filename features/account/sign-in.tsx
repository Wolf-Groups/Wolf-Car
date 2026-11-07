"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CodeStep } from "@/features/shop/code-step";
import { EmailStep } from "@/features/shop/email-step";
import { cn } from "@/lib/utils";
import { OTP_RESEND_SECONDS } from "@/shared/shop";

/** The code the API echoes in development; read once, so a production build never shows it. */
const SHOW_DEV_CODE = process.env.NODE_ENV !== "production";

export interface SignInProps {
  /** called once the code is verified and the session cookie is set */
  onSignedIn: () => void | Promise<void>;
  /** inside the checkout: no card of its own, the checkout's lead instead of the account's */
  embedded?: boolean;
}

/** Sign in with the email and the six-digit code sent there: the account pages, and "Sign in" at the checkout. */
export function SignIn({ onSignedIn, embedded = false }: SignInProps) {
  const t = useTranslations("Account");
  const tc = useTranslations("Checkout");
  const [email, setEmail] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [devCode, setDevCode] = useState<string>();

  return (
    <section
      className={cn("grid gap-5", !embedded && "mx-auto w-full max-w-md rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7")}
    >
      <div className="grid gap-3">
        {!embedded && (
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-accent/10 text-accent-ink">
            <Mail className="size-6" />
          </span>
        )}
        <div className="grid gap-1">
          <h2 className="text-xl font-extrabold">{t("signInTitle")}</h2>
          <p className="text-[15px] text-ink-2">{embedded ? tc("signInLead") : t("signInIntro")}</p>
        </div>
      </div>
      {email === null ? (
        <EmailStep
          onSent={(sent, code) => {
            setEmail(sent);
            setResendAt(Date.now() + OTP_RESEND_SECONDS * 1000);
            setDevCode(SHOW_DEV_CODE ? code : undefined);
          }}
        />
      ) : (
        <CodeStep
          email={email}
          resendAt={resendAt}
          devCode={devCode}
          onVerified={() => void onSignedIn()}
          onChangeEmail={() => {
            setEmail(null);
            setDevCode(undefined);
          }}
          onResent={(next) => {
            setResendAt(next);
            setDevCode(undefined);
          }}
        />
      )}
    </section>
  );
}
