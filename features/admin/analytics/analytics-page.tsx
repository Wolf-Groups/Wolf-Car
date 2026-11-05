"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, LoadingRows, NoAccess } from "@/components/app/states";
import { useAuth } from "@/features/auth/auth-provider";
import { api } from "@/lib/api/client";
import type { AnalyticsSummary } from "@/lib/api/types";
import { formatDate, formatNumber, qatarDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUrlState } from "../shared/url-state";

export const RANGES = [1, 7, 30, 90, 365] as const;
type Range = (typeof RANGES)[number];
const DEFAULT_RANGE: Range = 30;
const DAY_MS = 86_400_000;
/** longer periods are drawn one column per week, so a column stays wide enough to read and to tap on a phone */
const WEEKLY_ABOVE = 90;

/** The last `days` Qatar days, today included. */
export function rangeDays(days: number, now: Date = new Date()): { from: string; to: string } {
  return { from: qatarDay(new Date(now.getTime() - (days - 1) * DAY_MS)), to: qatarDay(now) };
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** noon UTC, so the day never shifts when it is formatted for Qatar */
const dayLabel = (day: string, locale: string) => formatDate(`${day}T12:00:00Z`, locale);

/** Visitor statistics of the public website. Super Admin only by default. */
export function AnalyticsPage() {
  const t = useTranslations("Analytics");
  const { can } = useAuth();
  if (!can("analytics.read")) {
    return (
      <>
        <PageHeader title={t("title")} />
        <NoAccess permission="analytics.read" />
      </>
    );
  }
  return <Analytics />;
}

function Analytics() {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const [filters, setFilters] = useUrlState(["range"] as const);
  const days = RANGES.find((r) => String(r) === filters.range) ?? DEFAULT_RANGE;
  const { from, to } = rangeDays(days);

  const summary = useQuery({
    queryKey: ["analytics", "summary", from, to],
    queryFn: () => api<AnalyticsSummary>("/analytics/summary", { query: { from, to } }),
    placeholderData: keepPreviousData,
  });

  const picker = (
    <div role="group" aria-label={t("range")} className="inline-flex flex-wrap gap-1 rounded-[var(--radius-brand)] border border-line bg-surface p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={r === days}
          onClick={() => setFilters({ range: r === DEFAULT_RANGE ? "" : String(r) })}
          className={cn(
            "min-h-11 rounded-[8px] px-3.5 text-sm font-bold transition-colors md:min-h-10",
            r === days ? "bg-accent text-white" : "text-ink-2 hover:bg-sand hover:text-ink",
          )}
        >
          {t(`ranges.${r}`)}
        </button>
      ))}
    </div>
  );

  const data = summary.data;
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={picker} />
      {summary.isPending ? (
        <LoadingRows rows={6} className="h-24" />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : data ? (
        <div className={cn("grid grid-cols-1 gap-5 transition-opacity", summary.isPlaceholderData && "opacity-60")}>
          <p className="text-sm font-semibold text-muted">{t("period", { from: dayLabel(data.from, locale), to: dayLabel(data.to, locale) })}</p>
          {data.totals.pageviews === 0 && data.totals.visitors === 0 ? (
            <EmptyState title={t("empty")} body={t("emptyBody")} />
          ) : (
            <Report data={data} days={days} />
          )}
        </div>
      ) : null}
    </>
  );
}

function Report({ data, days }: { data: AnalyticsSummary; days: number }) {
  const t = useTranslations("Analytics");
  const { totals: now, previous: before } = data;
  const contacts = (x: AnalyticsSummary["totals"]) => x.whatsappOrder + x.whatsappBooking + x.whatsappChat + x.calls;
  const pageName = (path: string) => {
    const key = path === "/" ? "home" : path.slice(1);
    return t.has(`pageNames.${key}`) ? t(`pageNames.${key}`) : path;
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label={t("tiles.visitors")} value={now.visitors} before={before.visitors} days={days} hint={t("visitorsHint")} />
        <Tile label={t("tiles.pageviews")} value={now.pageviews} before={before.pageviews} days={days} />
        <Tile label={t("tiles.contacts")} value={contacts(now)} before={contacts(before)} days={days} />
        <Tile label={t("tiles.orders")} value={now.whatsappOrder} before={before.whatsappOrder} days={days} />
        <Tile label={t("tiles.addToCart")} value={now.addToCart} before={before.addToCart} days={days} />
        <Tile label={t("tiles.wolfos")} value={now.wolfos} before={before.wolfos} days={days} />
      </div>

      {data.daily.length > 1 && <DailyChart daily={data.daily} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={t("funnel")} hint={t("funnelHint")}>
          <BarList
            max={now.visitors}
            rows={[
              { key: "visitors", label: t("funnelSteps.visitors"), value: now.visitors, note: "" },
              { key: "added", label: t("funnelSteps.added"), value: now.visitorsAdded, note: t("ofVisitors", { percent: percent(now.visitorsAdded, now.visitors) }) },
              {
                key: "ordered",
                label: t("funnelSteps.ordered"),
                value: now.visitorsOrdered,
                note: t("ofVisitors", { percent: percent(now.visitorsOrdered, now.visitors) }),
              },
            ]}
          />
        </Card>
        <Card title={t("contacts")}>
          <BarList
            rows={(["whatsappOrder", "whatsappBooking", "whatsappChat", "calls"] as const).map((key) => ({
              key,
              label: t(`contactTypes.${key}`),
              value: now[key],
              note: t("times", { count: now[key] }),
            }))}
          />
        </Card>
        <Card title={t("sources")}>
          <BarList
            rows={data.sources.map((s) => ({ key: s.source, label: t(`sourceNames.${s.source}`), value: s.visits, note: t("visits", { count: s.visits }) }))}
          />
        </Card>
        <Card title={t("pages")}>
          <BarList rows={data.pages.map((p) => ({ key: p.path, label: pageName(p.path), value: p.views, note: t("views", { count: p.views }) }))} />
        </Card>
        <Card title={t("products")}>
          <BarList
            rows={data.products.map((p, i) => ({ key: p.id ?? `${p.name}-${i}`, label: p.name, value: p.count, note: t("times", { count: p.count }) }))}
          />
        </Card>
        <Card title={t("models")}>
          <BarList rows={data.models.map((m) => ({ key: m.name, label: m.name, value: m.count, note: t("times", { count: m.count }) }))} />
        </Card>
        <Card title={t("devices")}>
          <BarList
            rows={data.devices.map((d) => ({
              key: d.device,
              label: t(`deviceNames.${d.device}`),
              value: d.visitors,
              note: t("visitorsCount", { count: d.visitors }),
            }))}
          />
        </Card>
        <Card title={t("locales")}>
          <BarList
            rows={data.locales.map((l) => ({
              key: l.locale,
              label: t.has(`localeNames.${l.locale}`) ? t(`localeNames.${l.locale}`) : l.locale,
              value: l.visitors,
              note: t("visitorsCount", { count: l.visitors }),
            }))}
          />
        </Card>
      </div>
    </>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5">
      <h2 className="text-[17px] font-extrabold">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A headline number with how it moved against the period before. */
function Tile({ label, value, before, days, hint }: { label: string; value: number; before: number; days: number; hint?: string }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const change = before === 0 ? (value === 0 ? "same" : "new") : value === before ? "same" : value > before ? "up" : "down";
  const moved = before === 0 ? 0 : Math.round((Math.abs(value - before) / before) * 100);
  const Arrow = change === "up" || change === "new" ? ArrowUpRight : change === "down" ? ArrowDownRight : Minus;
  return (
    <div className="rounded-[var(--radius-brand-lg)] border border-line bg-surface p-4">
      <p className="text-sm font-semibold text-ink-2">{label}</p>
      <p className="mt-1.5 text-[30px] leading-none font-extrabold tabular-nums">{formatNumber(value, locale)}</p>
      {/* the arrow and the words carry the direction; the text keeps its ink colour */}
      <p className="mt-2 flex items-start gap-1 text-xs leading-snug text-muted">
        <Arrow className="mt-px size-3.5 shrink-0" aria-hidden="true" strokeWidth={2.2} />
        {t(`change.${change}`, { percent: moved, days })}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/**
 * One column per day, all in the brand colour (a single series, so the title
 * names it and there is no legend). Hovering or focusing a column shows the
 * day's numbers; the same figures sit in a table for screen readers.
 */
interface ChartColumn {
  from: string;
  to: string;
  /** visitors of the day, or of the average day of the week */
  visitors: number;
  pageviews: number;
  contacts: number;
}

/** One column per day; past WEEKLY_ABOVE days, one per week holding its average day (visitors of different days cannot be added up). */
export function chartColumns(daily: AnalyticsSummary["daily"]): ChartColumn[] {
  if (daily.length <= WEEKLY_ABOVE) return daily.map((d) => ({ from: d.day, to: d.day, visitors: d.visitors, pageviews: d.pageviews, contacts: d.contacts }));
  const columns: ChartColumn[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const week = daily.slice(i, i + 7);
    const sum = (key: "visitors" | "pageviews" | "contacts") => week.reduce((total, d) => total + d[key], 0);
    const visitors = sum("visitors");
    columns.push({
      from: week[0].day,
      to: week[week.length - 1].day,
      visitors: visitors === 0 ? 0 : Math.max(1, Math.round(visitors / week.length)),
      pageviews: sum("pageviews"),
      contacts: sum("contacts"),
    });
  }
  return columns;
}

function DailyChart({ daily }: { daily: AnalyticsSummary["daily"] }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const [active, setActive] = useState<number | null>(null);
  const columns = chartColumns(daily);
  const peak = Math.max(1, ...columns.map((d) => d.visitors));
  // a round number at or above the busiest day, for the axis
  const step = 10 ** Math.floor(Math.log10(peak));
  const top = Math.max(1, Math.ceil(peak / step) * step);
  const shown = active === null ? null : columns[active];

  return (
    <section className="rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[17px] font-extrabold">{t("daily")}</h2>
        <p className="min-h-5 text-sm text-ink-2" aria-live="polite">
          {shown &&
            (shown.from === shown.to
              ? t("dailyTip", { day: dayLabel(shown.from, locale), visitors: shown.visitors, pageviews: shown.pageviews, contacts: shown.contacts })
              : t("weeklyTip", { from: dayLabel(shown.from, locale), to: dayLabel(shown.to, locale), visitors: shown.visitors, pageviews: shown.pageviews, contacts: shown.contacts }))}
        </p>
      </div>
      <div className="mt-4 flex gap-2" aria-hidden="true">
        <div className="flex h-44 flex-col justify-between text-end text-xs text-muted tabular-nums">
          <span>{formatNumber(top, locale)}</span>
          <span>{formatNumber(top / 2, locale)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            <span className="border-t border-line" />
            <span className="border-t border-line" />
            <span className="border-t border-line" />
          </div>
          <div className="relative flex h-44 items-end gap-px" onMouseLeave={() => setActive(null)}>
            {columns.map((d, i) => (
              <button
                key={d.from}
                type="button"
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(i)}
                className="group flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <span
                  className={cn(
                    "w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity",
                    active !== null && active !== i && "opacity-45",
                  )}
                  style={{ height: `${(d.visitors / top) * 100}%`, minHeight: d.visitors > 0 ? 2 : 0 }}
                />
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted">
            <span>{dayLabel(daily[0].day, locale)}</span>
            <span>{dayLabel(daily[daily.length - 1].day, locale)}</span>
          </div>
        </div>
      </div>
      {/* a table ignores the 1px width of sr-only and would widen the page, so the wrapper is what gets clipped */}
      <div className="sr-only">
        <table>
          <caption>{t("daily")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("table.day")}</th>
              <th scope="col">{t("table.visitors")}</th>
              <th scope="col">{t("table.pageviews")}</th>
              <th scope="col">{t("table.contacts")}</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.day}>
                <th scope="row">{dayLabel(d.day, locale)}</th>
                <td>{d.visitors}</td>
                <td>{d.pageviews}</td>
                <td>{d.contacts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface BarRow {
  key: string;
  label: string;
  value: number;
  /** the value in words ("12 visits"), shown at the end of the row */
  note: string;
}

/** A ranked list: the name, the number in words and a thin bar for its size. */
function BarList({ rows, max }: { rows: BarRow[]; max?: number }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const top = Math.max(1, max ?? 0, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted">{t("none")}</p>;
  return (
    <ul className="grid grid-cols-1 gap-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-[15px]">
            <span dir="auto" className="min-w-0 truncate font-semibold">
              {r.label}
            </span>
            <span className="shrink-0 text-sm text-ink-2 tabular-nums">{r.note || formatNumber(r.value, locale)}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-sand" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.value / top) * 100}%`, minWidth: r.value > 0 ? 4 : 0 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
