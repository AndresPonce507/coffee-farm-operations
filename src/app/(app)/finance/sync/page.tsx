import { getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { shortDate } from "@/lib/utils";
import {
  getAccountMap,
  getFailedSyncs,
  getSyncHealth,
  type SyncHealthRow,
} from "../data";
import { SyncConsole } from "./sync-console.client";

/**
 * /finance/sync — the accounting-sync console (P3-S17).
 *
 * QBO / Xero / the Panama DGI PAC bridge. We MAP our coffee-native ledger keys onto
 * the buyer's chart of accounts (account_map), we never rebuild bookkeeping. Each
 * target's queue depth + failures render as a health card that turns red the moment a
 * post fails (the dead-guard alarm). The interactive island drains the queue (the $0
 * mock worker that stamps a fake CUFE in dev) and edits the account map. Server
 * Component for the reads; the island for the writes.
 */

type FinanceT = Awaited<ReturnType<typeof getTranslations<"finance">>>;

export default async function SyncPage() {
  const t = await getTranslations("finance");
  const [health, accountMap, failed] = await Promise.all([
    getSyncHealth(),
    getAccountMap(),
    getFailedSyncs(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("sync.title")} subtitle={t("sync.subtitle")} />

      <SyncConsole />

      {/* per-target health */}
      {health.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center text-sm text-muted-fg">
          {t("sync.health.empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {health.map((h) => (
            <HealthCard key={h.target} h={h} t={t} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* account map */}
        <section data-testid="account-map" className="glass-card rounded-2xl p-5">
          <h2 className="font-display text-base font-semibold text-ink">
            {t("sync.map.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-fg">{t("sync.map.subtitle")}</p>
          {accountMap.length === 0 ? (
            <p className="mt-3 text-sm text-muted-fg">{t("sync.map.empty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {accountMap.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{m.matchKey}</p>
                    <p className="text-xs text-muted-fg">
                      {t(`sync.target.${m.target}` as "sync.target.qbo")}
                      {" · "}
                      {t(`sync.map.kind.${m.entryKind}` as "sync.map.kind.revenue")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums text-forest">
                      {m.accountCode}
                    </p>
                    {m.accountName && (
                      <p className="text-xs text-muted-fg">{m.accountName}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* failed posts */}
        <section data-testid="failed-posts" className="glass-card rounded-2xl p-5">
          <h2 className="font-display text-base font-semibold text-ink">
            {t("sync.failed.title")}
          </h2>
          {failed.length === 0 ? (
            <p className="mt-3 text-sm text-muted-fg">{t("sync.failed.empty")}</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {failed.map((f) => (
                <li
                  key={f.id}
                  className="rounded-xl border border-cherry-100 bg-cherry-100/30 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-ink">{f.entityRef}</p>
                    <Badge tone="danger" dot>
                      {t(`sync.target.${f.target}` as "sync.target.qbo")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-fg">
                    {f.lastError ?? "—"}
                    {" · "}
                    <span className="tabular-nums">
                      {t("sync.failed.attempts", { n: f.attempts })}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function HealthCard({ h, t }: { h: SyncHealthRow; t: FinanceT }) {
  const stalled = h.failed > 0;
  return (
    <div
      data-testid={`sync-health-${h.target}`}
      className="glass-card rounded-2xl p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-base font-semibold text-ink">
          {t(`sync.target.${h.target}` as "sync.target.qbo")}
        </p>
        {stalled ? (
          <Badge tone="danger" dot>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t("sync.health.alarm")}
          </Badge>
        ) : (
          <Badge tone="ok" dot>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {t("sync.health.healthy")}
          </Badge>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
        <Stat label={t("sync.health.pending")} value={h.pending} />
        <Stat label={t("sync.health.inFlight")} value={h.inFlight} />
        <Stat label={t("sync.health.failed")} value={h.failed} danger={stalled} />
        <Stat label={t("sync.health.synced")} value={h.synced} />
      </dl>
      {h.oldestUnsyncedAt && (
        <p className="mt-3 text-xs text-muted-fg">
          {t("sync.health.oldest", { date: shortDate(h.oldestUnsyncedAt) })}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg bg-paper/70 px-1 py-2">
      <p
        className={`font-display text-lg font-bold tabular-nums ${
          danger ? "text-cherry" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="text-[0.625rem] uppercase tracking-wide text-muted-fg">{label}</p>
    </div>
  );
}
