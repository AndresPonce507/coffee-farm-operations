import { getTranslations } from "next-intl/server";
import { Boxes, Coffee, Package, Sparkles, Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, usd } from "@/lib/utils";
import { CatalogManager } from "./catalog-manager.client";
import { getCatalog, getLotPicks, getProducts, type CatalogSku } from "./data";

/**
 * /shop — the storefront catalog manager (P3-S11 catalog + lot-linked SKUs +
 * finished-goods inventory).
 *
 * Every sellable bag lands as a glass card whose load-bearing detail is the green-lot
 * code it traces to — the FK that makes the whole shelf provenance-true (a SKU can
 * never claim a lot it isn't backed by; the DB + the create-SKU guard both enforce it).
 * The card shows pack/size, price, GTIN, the Reserve-Club mark, and the live finished-
 * goods readout (on hand / allocated / available) straight off finished_goods_atp —
 * available can never go negative (the fail-closed oversell guard, mirrored here).
 *
 * Server Component: the board reads the co-located storefront port; the only client JS
 * is the catalog manager (mint product / mint SKU / record movement) in the header.
 */

/** Dollars from integer cents, always 2dp. */
function priceFromCents(cents: number): string {
  return usd(cents / 100, 2);
}

export default async function ShopPage() {
  const t = await getTranslations("shop");
  const [catalog, products, lots] = await Promise.all([
    getCatalog(),
    getProducts(),
    getLotPicks(),
  ]);

  const skuCount = catalog.length;
  const productCount = products.length;
  const onHandTotal = catalog.reduce((acc, s) => acc + s.onHandUnits, 0);
  const reserveCount = catalog.filter((s) => s.isReserveClub).length;

  const movementSkus = catalog.map((s) => ({
    skuId: s.skuId,
    label: `${s.productName} · ${s.packFormat}/${s.bagSize} · ${s.greenLotCode}`,
    availableUnits: s.availableUnits,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")}>
        <CatalogManager products={products} lots={lots} skus={movementSkus} />
      </PageHeader>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.products")}
          value={num(productCount)}
          sub={t("summary.productsSub")}
          accent="coffee"
          icon={Coffee}
        />
        <Tile
          label={t("summary.skus")}
          value={num(skuCount)}
          sub={t("summary.skusSub")}
          accent="forest"
          icon={Package}
        />
        <Tile
          label={t("summary.onHand")}
          value={num(onHandTotal)}
          sub={t("summary.onHandSub")}
          accent="sky"
          icon={Boxes}
        />
        <Tile
          label={t("summary.reserve")}
          value={num(reserveCount)}
          sub={t("summary.reserveSub")}
          accent="honey"
          icon={Sparkles}
        />
      </div>

      {catalog.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {catalog.map((sku) => (
            <SkuCard key={sku.skuId} sku={sku} priceFromCents={priceFromCents} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function SkuCard({
  sku,
  priceFromCents,
  t,
}: {
  sku: CatalogSku;
  priceFromCents: (cents: number) => string;
  t: Awaited<ReturnType<typeof getTranslations<"shop">>>;
}) {
  return (
    <div
      data-testid={`sku-card-${sku.skuId}`}
      className="glass-card glass-hover perf-contain flex flex-col rounded-2xl p-5"
    >
      {/* Header: product + variety, reserve mark */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {sku.productName}
          </p>
          <p className="text-xs text-muted-fg">
            {[sku.variety, `${sku.packFormat} · ${sku.bagSize}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {sku.isReserveClub ? (
          <Badge tone="forest" dot>
            {t("card.reserveClub")}
          </Badge>
        ) : (
          <Badge tone="neutral">{sku.bagSize}</Badge>
        )}
      </div>

      {/* Price */}
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-fg">
          {t("card.price")}
        </p>
        <p className="font-display text-2xl font-bold tabular-nums text-ink">
          {priceFromCents(sku.priceUsdCents)}
        </p>
      </div>

      {/* Traceability — the load-bearing green-lot link */}
      <div className="mt-4 rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5">
        <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
          {t("card.tracesTo")}
        </p>
        <p className="font-display text-sm font-semibold tabular-nums text-forest">
          {sku.greenLotCode}
        </p>
        {sku.gtin && (
          <p className="mt-0.5 text-[0.6875rem] tabular-nums text-muted-fg">
            {t("card.gtin")} {sku.gtin}
          </p>
        )}
      </div>

      {/* Finished-goods readout — available can never go negative */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.625rem] uppercase tracking-wide text-muted-fg">
            {t("card.onHand")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {num(sku.onHandUnits)}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.625rem] uppercase tracking-wide text-muted-fg">
            {t("card.allocated")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {num(sku.allocatedUnits)}
          </p>
        </div>
        <div className="rounded-xl bg-forest/[0.06] px-3 py-2">
          <p className="text-[0.625rem] uppercase tracking-wide text-muted-fg">
            {t("card.available")}
          </p>
          <p
            data-testid={`sku-available-${sku.skuId}`}
            className="text-sm font-semibold tabular-nums text-forest"
          >
            {num(sku.availableUnits)}
          </p>
        </div>
      </div>

      {/* Footer: status */}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums text-muted-fg">
          {t("card.available")}: {num(sku.availableUnits)} {t("card.units")}
        </span>
        {!sku.isActive && (
          <Badge tone="warn">{t("card.inactive")}</Badge>
        )}
      </div>
    </div>
  );
}
