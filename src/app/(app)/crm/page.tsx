import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Building2,
  Coffee,
  DollarSign,
  Handshake,
  MailCheck,
  Users,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { cn, longDate, num, usd } from "@/lib/utils";
import {
  getContactDirectory,
  type ContactDirectoryRow,
  type ContactStatus,
} from "./data";
import { NewContactButton } from "./new-contact.client";

/**
 * /crm — the direct-trade contact directory (P3-S18 CRM backbone).
 *
 * Every contact lands as a glass roster card showing who they are (kind + stage), how
 * warm the relationship is (touchpoint count + last contact), what they're worth
 * (DERIVED lifetime value — NULL ⇒ "—", never a fabricated 0), and their marketing
 * consent state at a glance (the GDPR/CAN-SPAM lawful-basis flag). A segment rail
 * filters the roster by stage. The board is a Server Component; the only client JS in
 * this slice is the "new contact" composer and the per-contact action island.
 */

const STAGES: ContactStatus[] = ["lead", "prospect", "active", "dormant", "lost"];

const KIND_TONE: Record<string, BadgeTone> = {
  roaster: "forest",
  importer: "sky",
  agent: "coffee",
  distributor: "honey",
  retailer: "honey",
  press: "cherry",
  individual: "neutral",
  other: "neutral",
};

const STATUS_TONE: Record<ContactStatus, BadgeTone> = {
  lead: "neutral",
  prospect: "sky",
  active: "forest",
  dormant: "warn",
  lost: "danger",
};

type CrmT = Awaited<ReturnType<typeof getTranslations<"crm">>>;

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const t = await getTranslations("crm");
  const { segment } = await searchParams;
  const rows = await getContactDirectory();

  const active: "all" | ContactStatus =
    segment && (STAGES as string[]).includes(segment)
      ? (segment as ContactStatus)
      : "all";
  const visible = active === "all" ? rows : rows.filter((r) => r.status === active);

  const consenting = rows.filter(
    (r) => r.consentMarketing && r.unsubscribedAt == null,
  ).length;
  const activeCount = rows.filter((r) => r.status === "active").length;
  const totalValue = rows.reduce((acc, r) => acc + (r.lifetimeValueUsd ?? 0), 0);

  const countFor = (stage: "all" | ContactStatus) =>
    stage === "all" ? rows.length : rows.filter((r) => r.status === stage).length;

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")}>
        <NewContactButton />
      </PageHeader>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.total")}
          value={num(rows.length)}
          sub={t("summary.totalSub", { count: rows.length })}
          accent="forest"
          icon={Users}
        />
        <Tile
          label={t("summary.consenting")}
          value={num(consenting)}
          sub={t("summary.consentingSub")}
          accent="sky"
          icon={MailCheck}
        />
        <Tile
          label={t("summary.active")}
          value={num(activeCount)}
          sub={t("summary.activeSub")}
          accent="honey"
          icon={Handshake}
        />
        <Tile
          label={t("summary.value")}
          value={usd(Math.round(totalValue))}
          sub={t("summary.valueSub")}
          accent="coffee"
          icon={DollarSign}
        />
      </div>

      {/* Segment rail — stage filter as glass pills (server-side, URL-driven). */}
      <nav
        aria-label={t("segment.label")}
        className="-mx-1 flex flex-wrap gap-2 px-1"
      >
        <SegmentPill
          label={t("segment.all")}
          count={countFor("all")}
          href="/crm"
          active={active === "all"}
        />
        {STAGES.map((stage) => (
          <SegmentPill
            key={stage}
            label={t(`segment.${stage}`)}
            count={countFor(stage)}
            href={`/crm?segment=${stage}`}
            active={active === stage}
          />
        ))}
      </nav>

      {visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((row) => (
            <ContactCard key={row.contactId} row={row} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function SegmentPill({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2",
        active
          ? "bg-forest text-paper shadow-sm"
          : "border border-white/60 bg-white/60 text-muted-fg hover:bg-white/80 hover:text-ink",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[0.625rem] tabular-nums",
          active ? "bg-white/20 text-paper" : "bg-muted text-muted-fg",
        )}
      >
        {num(count)}
      </span>
    </Link>
  );
}

function ContactCard({ row, t }: { row: ContactDirectoryRow; t: CrmT }) {
  return (
    <Link
      href={`/crm/${encodeURIComponent(String(row.contactId))}`}
      data-testid={`contact-card-${row.contactId}`}
      className="glass-card glass-hover perf-contain block rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
    >
      {/* header: name + stage, kind badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold text-ink">
            {row.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={STATUS_TONE[row.status]} dot>
              {t(`status.${row.status}`)}
            </Badge>
            {row.countryCode && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-fg">
                <Building2 className="h-3 w-3" aria-hidden />
                {row.countryCode}
              </span>
            )}
          </div>
        </div>
        <Badge tone={KIND_TONE[row.kind] ?? "neutral"}>{t(`kind.${row.kind}`)}</Badge>
      </div>

      {/* headline KPI: lifetime value */}
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-fg">
          {t("card.value")}
        </p>
        <p className="font-display text-2xl font-bold tabular-nums text-ink">
          {row.lifetimeValueUsd == null || row.lifetimeValueUsd === 0
            ? "—"
            : usd(Math.round(row.lifetimeValueUsd))}
        </p>
      </div>

      {/* 2-up mini stat chips: touchpoints + last contact */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.touchpoints")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {row.eventCount > 0
              ? t("card.events", { count: row.eventCount })
              : t("card.noEvents")}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.lastContact")}
          </p>
          <p className="truncate text-sm font-medium text-ink">
            {row.lastEventAt
              ? longDate(row.lastEventAt)
              : t("card.noLastActivity")}
          </p>
        </div>
      </div>

      {/* consent band — the lawful-basis flag, never an honor-system UI toggle */}
      <div
        className={cn(
          "mt-4 flex items-center gap-2 rounded-xl border px-3 py-2",
          row.consentMarketing && row.unsubscribedAt == null
            ? "border-forest/15 bg-forest/[0.04] text-forest"
            : "border-line bg-muted/40 text-muted-fg",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        <span className="text-xs font-medium">
          {row.consentMarketing && row.unsubscribedAt == null
            ? t("card.consentOn")
            : t("card.consentOff")}
        </span>
      </div>

      {/* footer: linked buyer + open affordance */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-fg">
          {row.buyerName ? (
            <span className="inline-flex items-center gap-1">
              <Coffee className="h-3 w-3" aria-hidden />
              {t("card.buyer", { name: row.buyerName })}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs font-medium text-forest">
          {t("card.open")} →
        </span>
      </div>
    </Link>
  );
}
