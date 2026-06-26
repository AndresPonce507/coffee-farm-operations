import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, FileStack, Package, Ship } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import type { BadgeTone } from "@/components/ui/badge";
import { num } from "@/lib/utils";
import {
  getBuildableContracts,
  getShipments,
  type ShipmentRow,
  type ShipmentStatus,
} from "./data";
import { BuildShipment } from "./build-shipment.client";

/**
 * /sales/shipments — the export-shipment board (P3-S3 export-doc-pack engine).
 *
 * Every consignment lands here as a glass card carrying its status, line/bag totals,
 * and how many of its five trade documents are live. The build form (one client
 * island) mints a new consignment from a signed contract; each card opens the headline
 * detail — the five-tile traffic-light document pack. Server Component: the only client
 * JS is the build form + the per-shipment doc-pack island in the detail route.
 */

const STATUS_TONE: Record<ShipmentStatus, BadgeTone> = {
  building: "neutral",
  docs_issued: "honey",
  departed: "sky",
  arrived: "forest",
  closed: "forest",
};

export default async function ShipmentsPage() {
  const t = await getTranslations("shipments");
  const [shipments, contracts] = await Promise.all([
    getShipments(),
    getBuildableContracts(),
  ]);

  const buildingCount = shipments.filter((s) => s.status === "building").length;
  const docsIssuedCount = shipments.filter((s) => s.issuedCount > 0).length;
  const totalBags = shipments.reduce((acc, s) => acc + s.totalBags, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.shipments")}
          value={num(shipments.length)}
          sub={t("summary.shipmentsSub", { count: shipments.length })}
          accent="forest"
          icon={Ship}
        />
        <Tile
          label={t("summary.building")}
          value={num(buildingCount)}
          sub={t("summary.buildingSub")}
          accent="honey"
          icon={Package}
        />
        <Tile
          label={t("summary.docsIssued")}
          value={num(docsIssuedCount)}
          sub={t("summary.docsIssuedSub")}
          accent="sky"
          icon={FileStack}
        />
        <Tile
          label={t("summary.bags")}
          value={num(totalBags)}
          sub={t("summary.bagsSub")}
          accent="coffee"
          icon={CheckCircle2}
        />
      </div>

      <BuildShipment contracts={contracts} />

      {shipments.length === 0 ? (
        <EmptyState
          icon={Ship}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shipments.map((s) => (
            <ShipmentCard key={s.shipmentNo} ship={s} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShipmentCard({
  ship,
  t,
}: {
  ship: ShipmentRow;
  t: Awaited<ReturnType<typeof getTranslations<"shipments">>>;
}) {
  return (
    <Link
      href={`/sales/shipments/${encodeURIComponent(ship.shipmentNo)}`}
      data-testid={`shipment-card-${ship.shipmentNo}`}
      className="glass-card glass-hover perf-contain block rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {ship.shipmentNo}
          </p>
          <p className="truncate text-xs text-muted-fg">
            {t("card.contract")}: {ship.contractNo ?? "—"}
          </p>
        </div>
        <Badge tone={STATUS_TONE[ship.status]} dot>
          {t(`status.${ship.status}`)}
        </Badge>
      </div>

      <p className="mt-3 truncate font-display text-lg font-semibold text-ink">
        {ship.buyerName ?? t("card.noBuyer")}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label={t("card.lines")} value={num(ship.lineCount)} />
        <Stat label={t("card.bags")} value={num(ship.totalBags)} />
        <Stat label={t("card.netKg")} value={num(Math.round(ship.totalNetKg))} />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums text-muted-fg">
          {t("card.docs")}: {t("card.docsValue", { issued: ship.issuedCount })}
        </span>
        <span className="text-xs font-medium text-forest">{t("card.open")} →</span>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper/70 px-3 py-2">
      <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">{label}</p>
      <p className="text-sm font-medium tabular-nums text-ink">{value}</p>
    </div>
  );
}
