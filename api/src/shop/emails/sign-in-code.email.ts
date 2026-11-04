import { OTP_TTL_SECONDS } from '../../../../shared/shop';
import { ACCENT, emailLayout, escapeHtml } from '../../email/email-html';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const MINUTES = OTP_TTL_SECONDS / 60;

const COPY = {
  ar: {
    subject: (code: string) => `رمز الدخول إلى Wolf Car: ${code}`,
    intro: 'استخدم هذا الرمز لتسجيل الدخول إلى حسابك في Wolf Car:',
    valid: `الرمز صالح لمدة ${MINUTES} دقائق. لا تشاركه مع أحد.`,
    ignore: 'إذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.',
  },
  en: {
    subject: (code: string) => `Your Wolf Car sign-in code: ${code}`,
    intro: 'Use this code to sign in to your Wolf Car account:',
    valid: `The code is valid for ${MINUTES} minutes. Do not share it with anyone.`,
    ignore: "If you didn't ask for this code, you can ignore this email.",
  },
} as const;

/** The six-digit code a customer signs in to "My account" with. */
export function signInCodeEmail(code: string, locale: 'ar' | 'en'): EmailContent {
  const c = COPY[locale];
  const body = `<p style="margin:0 0 12px;">${escapeHtml(c.intro)}</p>
<p dir="ltr" style="margin:0 0 16px;font-size:34px;font-weight:bold;letter-spacing:6px;color:${ACCENT};">${escapeHtml(code)}</p>
<p style="margin:0 0 8px;">${escapeHtml(c.valid)}</p>
<p style="margin:0;color:#5c5c57;font-size:14px;">${escapeHtml(c.ignore)}</p>`;
  return {
    subject: c.subject(code),
    html: emailLayout({ locale, title: c.subject(code), body }),
    text: `${c.intro}\n\n${code}\n\n${c.valid}\n${c.ignore}`,
  };
}
