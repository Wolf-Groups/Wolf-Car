import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Direction } from "radix-ui";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StaticAuthProvider } from "@/features/auth/auth-provider";
import type { PermissionKey, Profile, RoleName } from "@/lib/api/types";
import arApp from "@/messages/app/ar";
import enApp from "@/messages/app/en";
import arSite from "@/messages/ar.json";
import enSite from "@/messages/en.json";

export function makeUser(overrides: Partial<Profile> & { role?: RoleName; permissions?: PermissionKey[] } = {}): Profile {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    username: "gh.manager",
    displayName: "GH Manager",
    email: null,
    role: "BRANCH_MANAGER",
    branch: { id: "b-gh", code: "GH", name: "Al Gharrafa Branch", nameAr: "فرع الغرافة" },
    branchHoldsWebOrders: false,
    twoFactorEnabled: false,
    hasShowroomPassword: true,
    permissions: [],
    ...overrides,
  };
}

export function messagesFor(locale: "ar" | "en") {
  const site = locale === "ar" ? arSite : enSite;
  return { Header: site.Header, Brand: site.Brand, ...(locale === "ar" ? arApp : enApp) };
}

/**
 * Renders with the same providers as the app (messages, react-query, RTL
 * direction, tooltips) and a fixed signed-in user. Returns a userEvent instance.
 */
export function renderWithApp(
  ui: ReactElement,
  { locale = "en", user = makeUser(), ...options }: { locale?: "ar" | "en"; user?: Profile | null } & Omit<RenderOptions, "wrapper"> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Asia/Qatar">
      <QueryClientProvider client={queryClient}>
        <Direction.Provider dir={locale === "ar" ? "rtl" : "ltr"}>
          <TooltipProvider>
            <StaticAuthProvider user={user}>{children}</StaticAuthProvider>
          </TooltipProvider>
        </Direction.Provider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
  return { user: userEvent.setup(), queryClient, ...render(ui, { wrapper, ...options }) };
}
