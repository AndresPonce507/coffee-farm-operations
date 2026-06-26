import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  FileText,
  Receipt,
  Wallet,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, usd } from "@/lib/utils";
import {
  getAging,
  getCashRunway,
  getSyncHealth,
  type AgingRow,
  type SyncHealthRow,
} from "./data";

/**
 * /finance — the cockpit (P3-S17 accounting cash/AR/sync seam).
 *
 * The estate's money at a glance: the net position where both ledgers cross (AR due
 * minus committed cost), what is outstanding, what is booked, and how many invoices
 * are still open — over a receivables aging board and a sync-health chip that turns
 * red the moment a post to QBO/Xero/PAC fails (the dead-guard alarm). Server
 * Component: every number reads from a security_invoker view, no client JS here.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  issued: "sky",
  partially_paid: "honey",
  paid: "ok",
  void: "danger",
};

type FinanceT = Awaited<ReturnType<typeof getTranslations<"finance">>>;

export default async function FinancePage() {
  const t = await getTranslations("finance");
  const [runway, aging, health] = await Promise.all([
    getCashRunway(),
    getAging(),
    getSyncHealth(),
  ]);

  const openInvoices = aging.filter(
    (a) => a.status !== "paid" && a.status !== "void" && a.balanceUsd > 0,
  );
  const totalFailed = health.reduce((acc, h) => acc + h.failed, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")}>
        <Link
          href="/finance/invoices"
          className="inline-flex h-9 items-center rounded-xl border border-white/60 bg-white/60 px-3 text-sm font-medium text-ink shadow-sm transition hover:bg-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
        >
          {t("aging.viewAll")}
        </Link>
      </PageHeader>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.net.label")}
          value={usd(runway.netPositionUsd)}
          sub={t("summary.net.sub")}
          accent={runway.netPositionUsd >= 0 ? "forest" : "cherry"}
          icon={Wallet}
        />
        <Tile
          label={t("summary.ar.label")}
          value={usd(runway.arOutstandingUsd)}
          sub={t("summary.ar.sub", { count: openInvoices.length })}
          accent="honey"
          icon={Coins}
        />
        <Tile
          label={t("summary.cost.label")}
          value={usd(runway.committedCostUsd)}
          sub={t("summary.cost.sub")}
          accent="coffee"
          icon={Receipt}
        />
        <Tile
          label={t("summary.open.label")}
          value={num(openInvoices.length)}
          sub={t("summary.open.sub")}
          accent="sky"
          icon={FileText}
        />
      </div>

      {aging.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Receivables aging board */}
          <section className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-ink">
                {t("aging.title")}
              </h2>
              <Link
                href="/finance/invoices"
                className="text-xs font-medium text-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
              >
                {t("aging.viewAll")} →
              </Link>
            </div>
            <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2">
              {aging.slice(0, 8).map((row) => (
                <AgingCard key={row.docNumber} row={row} t={t} />
              ))}
            </div>
          </section>

          {/* Sync health — the dead-guard alarm */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-ink">
                {t("health.title")}
              </h2>
              <Link
                href="/finance/sync"
                className="text-xs font-medium text-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
              >
                {t("health.viewAll")} →
              </Link>
            </div>
            <div className="glass-card rounded-2xl p-4">
              {totalFailed > 0 ? (
                <Badge tone="danger" dot>
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {t("health.alarm", { count: totalFailed })}
                </Badge>
              ) : (
                <Badge tone="ok" dot>
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  {t("health.healthy")}
                </Badge>
              )}
              <ul className="mt-3 space-y-2">
                {health.map((h) => (
                  <li
                    key={h.target}
                    className="flex items-center justify-between rounded-xl bg-paper/70 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-ink">
                      {t(`sync.target.${h.target}` as "sync.target.qbo")}
                    </span>
                    <span className="tabular-nums text-muted-fg">
                      {h.failed > 0 ? (
                        <span className="font-medium text-cherry">
                          {num(h.failed)} · {t("sync.health.failed")}
                        </span>
                      ) : (
                        t("health.healthy")
                      )}
                    </span>
                  </li>
                ))}
                {health.length === 0 && (
                  <li className="text-sm text-muted-fg">{t("sync.health.empty")}</li>
                )}
              </ul>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AgingCard({ row, t }: { row: AgingRow; t: FinanceT }) {
  return (
    <Link
      href={`/finance/invoices/${encodeURIComponent(row.docNumber)}`}
      data-testid={`aging-card-${row.docNumber}`}
      className="glass-card glass-hover perf-contain block rounded-2xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold text-ink">
            {row.docNumber}
          </p>
          <p className="text-xs text-muted-fg">
            {t(`kind.${row.kind}` as "kind.commercial_invoice")}
          </p>
        </div>
        <Badge tone={STATUS_TONE[row.status] ?? "neutral"} dot>
          {t(`status.${row.status}` as "status.issued")}
        </Badge>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("invoices.card.balance")}
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-ink">
            {usd(row.balanceUsd)}
          </p>
        </div>
        <span className="text-xs font-medium tabular-nums text-muted-fg">
          {t(`bucket.${row.agingBucket}` as "bucket.0-30")}
        </span>
      </div>
    </Link>
  );
}
