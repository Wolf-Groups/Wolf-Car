import type { ReactNode } from "react";
import { Wrap } from "./Button";
import { Footer } from "./Footer";
import { SubpageHeader } from "./SubpageHeader";
import { cn } from "@/lib/utils";

/**
 * Header, sand-coloured main area and footer for the customer pages (account,
 * checkout). The main area grows to fill the screen, so a short page keeps
 * its footer at the bottom instead of leaving white space under it.
 */
export function PublicPage({ children, width = "2xl" }: { children: ReactNode; width?: "xl" | "2xl" }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SubpageHeader />
      <main id="main" className="flex-1 bg-sand pt-6 pb-24 lg:pt-8">
        <Wrap>
          <div className={cn("mx-auto grid w-full gap-5", width === "xl" ? "max-w-xl" : "max-w-2xl")}>{children}</div>
        </Wrap>
      </main>
      <Footer />
    </div>
  );
}
