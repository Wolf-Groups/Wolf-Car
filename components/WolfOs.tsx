import { Download, ExternalLink } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { WOLFOS, wolfOsLink } from "@/lib/content";
import { Wrap } from "./Button";

/**
 * "Our app": WolfOS, the launcher we make for the BYD Leopard's screens, in its own night and
 * ember colours so it stands apart from the rest of the page in both themes. Both buttons open
 * wolfcaros.com in a new tab. Phones stack it: the words, the screen, the numbers, the buttons.
 */
export function WolfOs() {
  const t = useTranslations("WolfOs");
  const locale = useLocale() as Locale;
  const stats = [
    { value: WOLFOS.stats.screens, label: t("screens") },
    { value: WOLFOS.stats.apps, label: t("apps") },
    { value: WOLFOS.stats.themes, label: t("themes") },
  ];

  return (
    <section id="wolfos" aria-labelledby="wolfos-h" className="scroll-mt-24 py-10 lg:py-16">
      <Wrap>
        <div className="relative isolate overflow-hidden rounded-[28px] bg-[#0c0a09] px-5 py-8 text-[#f5ede6] shadow-[0_30px_80px_-40px_rgba(255,122,24,0.55)] sm:px-8 sm:py-10 lg:px-12 lg:py-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_100%_0%,rgba(255,122,24,0.16),transparent_45%)]"
          />
          <div className="grid gap-7 lg:grid-cols-[1.05fr_1fr] lg:gap-x-12 lg:gap-y-8">
            <div className="lg:col-start-1 lg:row-start-1">
              <p className="inline-block rounded-full border border-[#ff7a18]/40 bg-[#ff7a18]/15 px-3 py-0.5 text-xs font-extrabold text-[#fdb074]">
                {t("chip")}
              </p>
              <h2 id="wolfos-h" className="mt-4 flex items-center gap-2.5 text-[34px] leading-none font-black text-white lg:text-[46px]">
                <Image src="/assets/wolfos/wolf.webp" alt="" width={48} height={48} className="size-10 lg:size-12" />
                WolfOS
              </h2>
              <p className="mt-3 text-[19px] leading-snug font-extrabold lg:text-[24px]">
                {t.rich("tagline", { hl: (chunks) => <span className="whitespace-nowrap text-[#ff7a18]">{chunks}</span> })}
              </p>
              <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-[#d9cdc2] lg:text-base">{t("body")}</p>
            </div>

            <div className="relative lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
              {/* the ember glow follows the screen, wherever the layout puts it */}
              <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[40px] bg-[#ff7a18]/25 blur-3xl" />
              <Image
                src="/assets/wolfos/dashboard.webp"
                alt={t("imageAlt")}
                width={1400}
                height={787}
                sizes="(min-width:1160px) 500px, (min-width:1024px) 42vw, 100vw"
                className="h-auto w-full rounded-2xl border border-[#ff7a18]/35 shadow-[0_30px_70px_-20px_rgba(255,122,24,0.45)] lg:ltr:[transform:perspective(900px)_rotateY(-8deg)] lg:rtl:[transform:perspective(900px)_rotateY(8deg)]"
              />
            </div>

            <div className="lg:col-start-1 lg:row-start-2">
              <dl aria-label={t("statsAria")} className="grid grid-cols-3 text-center sm:flex sm:gap-10 sm:text-start">
                {stats.map((s) => (
                  <div key={s.label} className="flex flex-col-reverse">
                    <dt className="text-xs text-[#b3a393]">{s.label}</dt>
                    <dd className="text-2xl font-black text-white">{s.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 grid gap-2.5 sm:flex sm:flex-wrap">
                <a
                  {...wolfOsLink(WOLFOS.site(locale), "section")}
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] bg-gradient-to-br from-accent to-accent-dark px-6 text-[17px] font-extrabold text-white shadow-[0_12px_32px_-10px_rgba(255,122,24,0.75)] transition hover:brightness-110"
                >
                  {t("discover")}
                  <ExternalLink className="size-[18px]" aria-hidden="true" strokeWidth={2.2} />
                  <span className="sr-only">{t("newTab")}</span>
                </a>
                <a
                  {...wolfOsLink(WOLFOS.download(locale), "download")}
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-[#f5ede6]/35 px-6 text-[17px] font-bold text-[#f5ede6] transition-colors hover:border-[#f5ede6]"
                >
                  <Download className="size-[18px]" aria-hidden="true" strokeWidth={2.2} />
                  {t("download")}
                  <span className="sr-only">{t("newTab")}</span>
                </a>
              </div>
              <p className="mt-3 text-center text-xs text-[#a39283] sm:text-start">{t("models")}</p>
            </div>
          </div>
        </div>
      </Wrap>
    </section>
  );
}
