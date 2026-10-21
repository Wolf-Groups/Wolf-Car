import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api/client";

/**
 * Turns a failed shop call into text from the website's `Checkout.errors.*`.
 * (`useErrorMessage` reads the staff `Errors.*` namespace, which the public site never loads.)
 */
export function useCheckoutError() {
  const t = useTranslations("Checkout");
  return (e: unknown): string => {
    if (e instanceof ApiError && e.code && t.has(`errors.${e.code}`)) return t(`errors.${e.code}`);
    return t("errors.generic");
  };
}
