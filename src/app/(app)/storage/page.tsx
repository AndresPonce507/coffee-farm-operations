import { getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Warehouse,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { longDate, num } from "@/lib/utils";
import {
  getStorageBoard,
  type StorageBoard,
  type StorageCertVerdict,
} from "./data";
import { StorageCard } from "./storage-card";
import { StorageConsole } from "./storage-console.client";

/**
 * /storage — the controlled-environment dashboard (P3-S20 storage monitoring).
 *
 * Every location lands as a glass gauge card showing temperature, humidity, and water
 * activity against its target band, with an honest verdict (in band / out of band /
 * no readings yet — never a fabricated in-band claim). The console island logs $0
 * manual readings, mints locations, and issues storage certificates (the database
 * refuses a zero-readings window, so the verdict is always backed by evidence). The
 * certificate log below is the documented, tamper-evident record of every lot kept in
 * spec from green to sale. Server Component: the only client JS is the console island.
 */
const VERDICT_TONE: Record<StorageCertVerdict, "forest" | "danger" | "warn"> = {
  "in-band": "forest",
  excursion: "danger",
  "insufficient-data": "warn",
};

export default async function StoragePage() {
  const t = await getTranslations("storage");
  const board: StorageBoard = await getStorageBoard();
  const { locations, greenLots, certificates } = board;

  const inBandCount = locations.filter((l) => l.inBand === true).length;
  const excursionCount = locations.filter((l) => l.inBand === false).length;

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.locations")}
          value={num(locations.length)}
          sub={t("summary.locationsSub", { count: locations.length })}
          accent="forest"
          icon={Warehouse}
        />
        <Tile
          label={t("summary.inBand")}
          value={num(inBandCount)}
          sub={t("summary.inBandSub")}
          accent="forest"
          icon={CheckCircle2}
        />
        <Tile
          label={t("summary.excursions")}
          value={num(excursionCount)}
          sub={t("summary.excursionsSub")}
          accent="cherry"
          icon={AlertTriangle}
        />
        <Tile
          label={t("summary.certs")}
          value={num(certificates.length)}
          sub={t("summary.certsSub")}
          accent="honey"
          icon={FileCheck2}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          {locations.length === 0 ? (
            <EmptyState
              icon={Warehouse}
              title={t("empty.title")}
              description={t("empty.description")}
            />
          ) : (
            <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
              {locations.map((l) => (
                <StorageCard key={l.locationId} status={l} t={t} />
              ))}
            </div>
          )}
        </div>

        <StorageConsole
          locations={locations.map((l) => ({ code: l.code, name: l.name }))}
          greenLots={greenLots}
        />
      </div>

      <CertificateLog certificates={certificates} t={t} />
    </div>
  );
}

function CertificateLog({
  certificates,
  t,
}: {
  certificates: StorageBoard["certificates"];
  t: Awaited<ReturnType<typeof getTranslations<"storage">>>;
}) {
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-base font-semibold text-ink">
          {t("certs.title")}
        </p>
        <p className="text-xs text-muted-fg">{t("certs.subtitle")}</p>
      </div>

      {certificates.length === 0 ? (
        <p className="mt-4 text-sm text-muted-fg">{t("certs.empty")}</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {certificates.map((c) => (
            <li
              key={c.id}
              data-testid={`storage-cert-${c.id}`}
              className="flex flex-col gap-2 rounded-xl bg-paper/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-semibold text-ink">
                    {c.greenLotCode}
                  </span>
                  <Badge tone={VERDICT_TONE[c.verdict]} dot>
                    {t(`certs.verdict.${c.verdict}`)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-fg">
                  {c.locationName ?? "—"}
                  {" · "}
                  <span className="tabular-nums">
                    {t("certs.window", {
                      start: longDate(c.windowStart),
                      end: longDate(c.windowEnd),
                    })}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-xs tabular-nums text-muted-fg">
                <span>{t("certs.readings", { count: c.readingsCount })}</span>
                {c.inBandPct != null && (
                  <span className="font-medium text-forest">
                    {t("certs.inBandPct", { pct: num(c.inBandPct, 1) })}
                  </span>
                )}
                <span>{longDate(c.issuedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
