import { getTranslations } from "next-intl/server";
import { Coffee, DollarSign, Package, Receipt, Store } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, usd } from "@/lib/utils";
import {
  getPosSalesBook,
  getPosTerminals,
  getSellableSkus,
  type PosSaleRow,
} from "./data";
import { PosRegister } from "./pos-register.client";

/**
 * /pos — the offline DGI farm-store/café POS board (P3-S14).
 *
 * Server Component: it reads the three authoritative surfaces (active tills, the
 * sellable-SKU ATP, the recent sales book) and hands them to the one interactive
 * island, the register. The history strip below renders each recorded sale with its
 * human POS-NNNN folio, server-computed total + ITBMS, and its fiscal state — a NULL
 * `dgi_cufe` is shown as an internal non-fiscal recibo (the $0 path), NEVER a fabricated
 * CUFE; a real folio appears only once a (paid) PAC stamps it (P3-S16/S17, flagged).
 */

/** USD from integer cents (the schema's money unit), always 2 decimals. */
function centsUsd(cents: number): string {
  return usd(cents / 100, 2);
}

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "neutral",
  paid: "ok",
  fulfilled: "forest",
  cancelled: "danger",
  refunded: "warn",
};

export default async function PosPage() {
  const t = await getTranslations("pos");
  const [terminals, skus, sales] = await Promise.all([
    getPosTerminals(),
    getSellableSkus(),
    getPosSalesBook(),
  ]);

  const grossCents = sales.reduce((acc, s) => acc + s.totalCents, 0);
  const taxCents = sales.reduce((acc, s) => acc + s.dgiTaxCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.sales")}
          value={num(sales.length)}
          sub={t("summary.salesSub")}
          accent="forest"
          icon={Receipt}
        />
        <Tile
          label={t("summary.gross")}
          value={centsUsd(grossCents)}
          sub={t("summary.grossSub")}
          accent="honey"
          icon={DollarSign}
        />
        <Tile
          label={t("summary.tax")}
          value={centsUsd(taxCents)}
          sub={t("summary.taxSub")}
          accent="coffee"
          icon={Coffee}
        />
        <Tile
          label={t("summary.catalog")}
          value={num(skus.length)}
          sub={t("summary.catalogSub", { count: skus.length })}
          accent="sky"
          icon={Package}
        />
      </div>

      {terminals.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t("empty.noTerminals.title")}
          description={t("empty.noTerminals.description")}
        />
      ) : (
        <PosRegister terminals={terminals} skus={skus} />
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          {t("history.heading")}
        </h2>
        {sales.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("empty.noSales.title")}
            description={t("empty.noSales.description")}
          />
        ) : (
          <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sales.map((sale) => (
              <SaleCard key={sale.saleNo} sale={sale} t={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SaleCard({
  sale,
  t,
}: {
  sale: PosSaleRow;
  t: Awaited<ReturnType<typeof getTranslations<"pos">>>;
}) {
  return (
    <div
      data-testid={`pos-sale-${sale.saleNo}`}
      className="glass-card perf-contain rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {sale.saleNo}
          </p>
          <p className="truncate text-xs text-muted-fg">{sale.terminalName}</p>
        </div>
        <Badge tone={STATUS_TONE[sale.status] ?? "neutral"} dot>
          {t(`status.${sale.status}`)}
        </Badge>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <span className="text-xs font-medium text-muted-fg">
          {t("history.units", { count: sale.lineCount })}
        </span>
        <span className="font-display text-2xl font-bold tabular-nums text-forest">
          {centsUsd(sale.totalCents)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("history.subtotal")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {centsUsd(sale.subtotalCents)}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("history.tax")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {centsUsd(sale.dgiTaxCents)}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Badge tone={sale.dgiCufe ? "forest" : "neutral"}>
          {sale.dgiCufe
            ? t("history.fiscalStamped", { cufe: sale.dgiCufe })
            : t("history.fiscalPending")}
        </Badge>
      </div>
    </div>
  );
}
