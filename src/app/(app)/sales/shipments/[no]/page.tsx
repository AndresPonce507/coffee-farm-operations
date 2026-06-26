import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, MapPin, Package } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { num } from "@/lib/utils";
import {
  getShipment,
  type ShipmentDetail,
  type ShipmentLineRow,
  type ShipmentStatus,
} from "@/app/(app)/sales/shipments/data";
import { DocPack } from "./doc-pack.client";
import { LineLoader } from "./line-loader.client";

/**
 * /sales/shipments/[no] — THE HEADLINE: the export-document-pack engine.
 *
 * Server Component. Resolves the consignment by its public shipment number, 404s on an
 * unknown number (the ⌘K palette or a hand-typed URL can route to a shipment that
 * doesn't exist — never a fabricated consignment). The left rail is the consignment
 * story (consignee, contract, loaded lines); the right rail is the five-tile
 * traffic-light document pack — the one interactive island — where each doc shows
 * red/amber/green from the live `v_export_pack_readiness` verdict and a blocked doc
 * lists its EXACT unmet prerequisites. The bill of lading is chain-locked until the
 * other four issue. Issuing is online-only (it needs server truth).
 */

const STATUS_TONE: Record<ShipmentStatus, BadgeTone> = {
  building: "neutral",
  docs_issued: "honey",
  departed: "sky",
  arrived: "forest",
  closed: "forest",
};

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ no: string }>;
}) {
  const { no } = await params;
  const shipmentNo = decodeURIComponent(no);
  const t = await getTranslations("shipments");

  const detail = await getShipment(shipmentNo).catch(() => null);
  if (!detail) {
    notFound();
  }

  const { shipment, readiness, lines, issuedDocs, loadableLines } = detail;
  const isBuilding = shipment.status === "building";

  return (
    <div className="space-y-6">
      <Link
        href="/sales/shipments"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("detail.back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("detail.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {t("detail.title", { shipmentNo: shipment.shipmentNo })}
          </h1>
          <Badge tone={STATUS_TONE[shipment.status]} dot>
            {t(`status.${shipment.status}`)}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-fg">{t("detail.subtitle")}</p>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* LEFT: the consignment story + loaded lines */}
        <div className="space-y-6">
          <section className="glass-card rounded-2xl p-5">
            <h2 className="font-display text-base font-semibold text-ink">
              {t("detail.consignee")}
            </h2>
            <p className="mt-1 font-display text-lg font-semibold text-ink">
              {shipment.buyerName ?? t("detail.noBuyer")}
              {shipment.countryCode ? (
                <span className="ml-2 text-sm font-medium text-muted-fg">
                  {shipment.countryCode}
                </span>
              ) : null}
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              <Row label={t("detail.contract")} value={shipment.contractNo ?? "—"} />
              <Row
                label={t("detail.port")}
                value={shipment.portOfLoading}
                icon={<MapPin className="h-3.5 w-3.5" aria-hidden />}
              />
              <Row
                label={t("detail.bagWeight")}
                value={t("detail.bagWeightValue", { kg: num(shipment.bagWeightKg) })}
                icon={<Package className="h-3.5 w-3.5" aria-hidden />}
              />
            </dl>

            <p className="mt-4 rounded-xl bg-forest/[0.04] px-3 py-2.5 text-sm font-medium tabular-nums text-forest">
              {t("detail.totals", {
                bags: num(shipment.totalBags),
                kg: num(Math.round(shipment.totalNetKg)),
              })}
            </p>
          </section>

          <section className="glass-card rounded-2xl p-5">
            <h2 className="font-display text-base font-semibold text-ink">
              {t("lines.title")}
            </h2>

            {lines.length === 0 ? (
              <p className="mt-3 text-sm text-muted-fg">{t("lines.empty")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {lines.map((l) => (
                  <LineRow key={l.id} line={l} t={t} />
                ))}
              </ul>
            )}

            <div className="mt-4">
              {isBuilding ? (
                <LineLoader
                  shipmentId={shipment.id}
                  bagWeightKg={shipment.bagWeightKg}
                  loadableLines={loadableLines}
                />
              ) : (
                <p className="rounded-lg bg-paper/70 px-3 py-2 text-xs text-muted-fg">
                  {t("lines.lockedNote")}
                </p>
              )}
            </div>
          </section>
        </div>

        {/* RIGHT: the headline document pack */}
        <DocPack
          shipmentId={shipment.id}
          readiness={readiness}
          issuedDocs={issuedDocs}
          lineCount={shipment.lineCount}
        />
      </div>
    </div>
  );
}

type ShipmentsT = Awaited<ReturnType<typeof getTranslations<"shipments">>>;

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-muted-fg">
        {icon}
        {label}
      </dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function LineRow({ line, t }: { line: ShipmentLineRow; t: ShipmentsT }) {
  return (
    <li className="flex items-center justify-between rounded-xl bg-paper/70 px-3 py-2 text-sm">
      <span className="font-medium text-ink">{line.greenLotCode}</span>
      <span className="tabular-nums text-muted-fg">
        {t("lines.bags")}: {num(line.bags)} · {num(Math.round(line.netKg))} {t("lines.netKg")}
      </span>
    </li>
  );
}
