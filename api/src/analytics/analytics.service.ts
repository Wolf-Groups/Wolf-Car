import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SiteDevice, SiteSource } from '../../../shared/analytics';
import { addDays, dayStr, daysBetween, eachDay, qatarToday, toDate } from '../common/day';
import type { RequestMeta } from '../common/types';
import type { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deviceOf, isBot, referrerHost, sourceOf, splitPath, visitorHash } from './classify';
import type { SiteEventDto } from './dto/analytics.dto';

/** Rows older than this many days are deleted. */
export const RETENTION_DAYS = 400;
export const MAX_RANGE_DAYS = 366;
const TOP = 10;
const DAY_MS = 86_400_000;

export interface AnalyticsTotals {
  /** people per day, added up over the range */
  visitors: number;
  visits: number;
  pageviews: number;
  whatsappOrder: number;
  whatsappBooking: number;
  whatsappChat: number;
  calls: number;
  addToCart: number;
  /** visitors who added something to the basket */
  visitorsAdded: number;
  /** visitors who sent the basket on WhatsApp */
  visitorsOrdered: number;
  /** visitors who pressed any WhatsApp or call button */
  visitorsContacted: number;
  /** presses on a link to WolfOS, our app */
  wolfos: number;
}

export interface AnalyticsSummary {
  from: string;
  to: string;
  totals: AnalyticsTotals;
  /** the same number of days just before `from` */
  previous: AnalyticsTotals;
  daily: { day: string; visitors: number; pageviews: number; contacts: number }[];
  pages: { path: string; views: number; visitors: number }[];
  sources: { source: SiteSource; visits: number }[];
  devices: { device: SiteDevice; visitors: number }[];
  locales: { locale: string; visitors: number }[];
  products: { id: string | null; name: string; count: number }[];
  models: { name: string; count: number }[];
}

type Counts = Record<keyof AnalyticsTotals, bigint>;
const num = (value: bigint | number | null | undefined): number => Number(value ?? 0);

@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    void this.prune();
    this.timer = setInterval(() => void this.prune(), DAY_MS);
    // never keeps the process alive on shutdown
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Deletes what is older than the retention period. Returns how many rows went. */
  async prune(today: string = qatarToday()): Promise<number> {
    try {
      const { count } = await this.prisma.siteEvent.deleteMany({ where: { day: { lt: toDate(addDays(today, -RETENTION_DAYS)) } } });
      if (count) this.logger.log(`Deleted ${count} visitor statistics rows older than ${RETENTION_DAYS} days`);
      return count;
    } catch (error) {
      this.logger.warn(`Could not delete old visitor statistics: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  /**
   * Stores one event from the public website. Crawlers and anything that is
   * not a public page are dropped without an error: the page never waits for
   * or reads the answer.
   */
  async record(dto: SiteEventDto, meta: RequestMeta, ownHost: string | undefined, now: Date = new Date()): Promise<boolean> {
    const userAgent = meta.userAgent;
    if (!userAgent || isBot(userAgent)) return false;
    const page = splitPath(dto.path);
    if (!page) return false;

    const day = qatarToday(now);
    const entry = dto.type === 'pageview' && dto.entry === true;
    const host = entry ? referrerHost(dto.referrer, ownHost) : null;
    await this.prisma.siteEvent.create({
      data: {
        occurredAt: now,
        day: toDate(day),
        type: dto.type,
        visitor: visitorHash(this.config.get('JWT_ACCESS_SECRET', { infer: true }), day, meta.ip ?? '', userAgent),
        path: page.path,
        locale: page.locale,
        entry,
        source: entry ? sourceOf(dto.campaign, host, userAgent) : null,
        referrerHost: host,
        device: deviceOf(userAgent),
        label: dto.label || null,
        targetId: dto.targetId ?? null,
      },
    });
    return true;
  }

  async summary(from: string, to: string): Promise<AnalyticsSummary> {
    const days = daysBetween(from, to) + 1;
    if (days < 1) throw new BadRequestException({ code: 'ANALYTICS_RANGE_INVALID', message: 'The start day must not be after the end day.' });
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException({ code: 'ANALYTICS_RANGE_TOO_LONG', message: `Choose at most ${MAX_RANGE_DAYS} days.` });
    }
    const range = Prisma.sql`day BETWEEN ${from}::date AND ${to}::date`;
    const person = Prisma.sql`count(DISTINCT (day, visitor))`;

    const [totals, previous, daily, pages, sources, devices, locales, products, models] = await Promise.all([
      this.totals(from, to),
      this.totals(addDays(from, -days), addDays(from, -1)),
      this.prisma.$queryRaw<{ day: Date; visitors: bigint; pageviews: bigint; contacts: bigint }[]>`
        SELECT day,
               count(DISTINCT visitor) AS visitors,
               count(*) FILTER (WHERE type = 'pageview') AS pageviews,
               count(*) FILTER (WHERE type LIKE 'whatsapp%' OR type = 'call') AS contacts
        FROM site_events WHERE ${range} GROUP BY day`,
      this.prisma.$queryRaw<{ path: string; views: bigint; visitors: bigint }[]>`
        SELECT path, count(*) AS views, ${person} AS visitors
        FROM site_events WHERE ${range} AND type = 'pageview'
        GROUP BY path ORDER BY views DESC, path LIMIT ${TOP}`,
      this.prisma.$queryRaw<{ source: SiteSource; visits: bigint }[]>`
        SELECT coalesce(source, 'direct') AS source, count(*) AS visits
        FROM site_events WHERE ${range} AND entry
        GROUP BY 1 ORDER BY visits DESC, 1`,
      this.prisma.$queryRaw<{ device: SiteDevice; visitors: bigint }[]>`
        SELECT device, ${person} AS visitors
        FROM site_events WHERE ${range} GROUP BY device ORDER BY visitors DESC, device`,
      this.prisma.$queryRaw<{ locale: string; visitors: bigint }[]>`
        SELECT locale, ${person} AS visitors
        FROM site_events WHERE ${range} GROUP BY locale ORDER BY visitors DESC, locale`,
      this.prisma.$queryRaw<{ id: string | null; name: string | null; count: bigint }[]>`
        SELECT target_id AS id, max(label) AS name, count(*) AS count
        FROM site_events WHERE ${range} AND type = 'add_to_cart'
        GROUP BY target_id ORDER BY count DESC, name LIMIT ${TOP}`,
      this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
        SELECT label AS name, count(*) AS count
        FROM site_events WHERE ${range} AND type = 'model_view' AND label IS NOT NULL
        GROUP BY label ORDER BY count DESC, name LIMIT ${TOP}`,
    ]);

    const byDay = new Map(daily.map((d) => [dayStr(d.day), d]));
    return {
      from,
      to,
      totals,
      previous,
      daily: eachDay(from, to).map((day) => {
        const row = byDay.get(day);
        return { day, visitors: num(row?.visitors), pageviews: num(row?.pageviews), contacts: num(row?.contacts) };
      }),
      pages: pages.map((p) => ({ path: p.path, views: num(p.views), visitors: num(p.visitors) })),
      sources: sources.map((s) => ({ source: s.source, visits: num(s.visits) })),
      devices: devices.map((d) => ({ device: d.device, visitors: num(d.visitors) })),
      locales: locales.map((l) => ({ locale: l.locale, visitors: num(l.visitors) })),
      products: products.map((p) => ({ id: p.id, name: p.name ?? '', count: num(p.count) })),
      models: models.map((m) => ({ name: m.name, count: num(m.count) })),
    };
  }

  private async totals(from: string, to: string): Promise<AnalyticsTotals> {
    const [row] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(DISTINCT (day, visitor)) AS "visitors",
             count(*) FILTER (WHERE entry) AS "visits",
             count(*) FILTER (WHERE type = 'pageview') AS "pageviews",
             count(*) FILTER (WHERE type = 'whatsapp_order') AS "whatsappOrder",
             count(*) FILTER (WHERE type = 'whatsapp_booking') AS "whatsappBooking",
             count(*) FILTER (WHERE type = 'whatsapp_chat') AS "whatsappChat",
             count(*) FILTER (WHERE type = 'call') AS "calls",
             count(*) FILTER (WHERE type = 'add_to_cart') AS "addToCart",
             count(DISTINCT (day, visitor)) FILTER (WHERE type = 'add_to_cart') AS "visitorsAdded",
             count(DISTINCT (day, visitor)) FILTER (WHERE type = 'whatsapp_order') AS "visitorsOrdered",
             count(DISTINCT (day, visitor)) FILTER (WHERE type LIKE 'whatsapp%' OR type = 'call') AS "visitorsContacted",
             count(*) FILTER (WHERE type = 'wolfos') AS "wolfos"
      FROM site_events WHERE day BETWEEN ${from}::date AND ${to}::date`;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, num(value)])) as unknown as AnalyticsTotals;
  }
}
