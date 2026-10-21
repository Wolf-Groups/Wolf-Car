import { render, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Direction } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";

/**
 * Renders a public website component the way app/[locale]/layout.tsx does:
 * only the site's messages (messages/{ar,en}.json), no staff providers, no
 * react-query, no toaster. Returns a userEvent instance.
 */
export function renderOnSite(ui: ReactElement, { locale = "en", ...options }: { locale?: "ar" | "en" } & Omit<RenderOptions, "wrapper"> = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en} timeZone="Asia/Qatar">
      <Direction.Provider dir={locale === "ar" ? "rtl" : "ltr"}>{children}</Direction.Provider>
    </NextIntlClientProvider>
  );
  return { user: userEvent.setup(), ...render(ui, { wrapper, ...options }) };
}
