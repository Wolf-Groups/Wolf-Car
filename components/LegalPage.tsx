import { getLocale, getTranslations } from "next-intl/server";
import { Wrap } from "./Button";
import { Footer } from "./Footer";
import { SubpageHeader } from "./SubpageHeader";
import { getBranchList } from "@/lib/branches";
import { SOCIAL } from "@/lib/content";
import { LEGAL_UPDATED, type LegalDoc } from "@/lib/legal";

/** Shared layout for the privacy policy, terms and refund policy pages. */
export async function LegalPage({ doc }: { doc: LegalDoc }) {
  const locale = await getLocale();
  const t = await getTranslations("Legal");
  const updated = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "long",
    timeZone: "Asia/Qatar",
  }).format(new Date(doc.updated ?? LEGAL_UPDATED));

  return (
    <>
      <SubpageHeader />
      <main id="main" className="bg-sand py-14 lg:py-20">
        <Wrap>
          <article className="mx-auto max-w-[760px] rounded-[22px] border border-line bg-surface px-6 py-9 md:px-12 md:py-12">
            <h1 className="text-[clamp(28px,5.6vw,40px)] leading-[1.25] font-extrabold">
              {doc.title}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {t("updated", { date: updated })}
            </p>
            <p className="mt-6 text-ink-2">{doc.intro}</p>
            {doc.sections.map((s) => (
              <section key={s.heading} className="mt-8">
                <h2 className="text-xl font-bold">{s.heading}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p} className="mt-2 text-ink-2">
                    {p}
                  </p>
                ))}
              </section>
            ))}
            <section className="mt-10 rounded-[var(--radius-brand-lg)] bg-sand p-5">
              <h2 className="text-lg font-bold">{t("contactTitle")}</h2>
              <ul className="mt-2 grid list-none gap-1 text-ink-2">
                <li>
                  {t("email")}:{" "}
                  <a
                    href={`mailto:${SOCIAL.email}`}
                    dir="ltr"
                    className="font-semibold text-accent-ink hover:underline"
                  >
                    {SOCIAL.email}
                  </a>
                </li>
                {getBranchList(locale).map((b) => (
                  <li key={b.id}>
                    {b.name}:{" "}
                    <a
                      href={`tel:${b.tel}`}
                      dir="ltr"
                      className="font-semibold text-accent-ink hover:underline"
                    >
                      {b.tel}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </article>
        </Wrap>
      </main>
      <Footer />
    </>
  );
}
