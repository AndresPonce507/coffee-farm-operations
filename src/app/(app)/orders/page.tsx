import { getTranslations } from "next-intl/server";
import {
  BadgeCheck,
  Clock,
  DollarSign,
  Package,
  ShoppingBag,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, usd } from "@/lib/utils";
import {
  getOrderBook,
  getOrderCogs,
  type OrderCogsRow,
  type OrderRow,
  type OrderStatus,
} from "./data";

/**
 * /orders — the DTC order book (P3-S12).
 *
 * Every order lands as a glass card with its server-computed money breakdown
 * (subtotal, statutory ITBMS 7%, total — the total a tampered cart could never
 * underpay, since create_order reads price_usd_cents from the SKU), its fiscal state
 * (an internal folio once stamped, or "pending fiscal stamp" on the $0 non-fiscal
 * path), and the per-lot COST FLOOR behind the lots it ships. That floor is
 * `mv_lot_cost.cost_per_kg_green`; when cost was never booked it reads NULL and the
 * card flags "cost not booked yet" rather than inventing a number (rail §5).
 *
 * Server Component, read-only: order writes flow through the SECURITY DEFINER RPCs
 * (storefront checkout, the service_role-only Stripe webhook + PAC stamp), never this
 * admin board.
 */

/** Cents → dollars, 2dp (money on a receipt always carries its cents). */
const money = (cents: number) => usd(cents / 100, 2);
/** Per-kg cost floor: 2dp under $100, 0dp above (reserve $/kg vs commodity ~$3). */
const perKg = (v: number) => usd(v, v < 100 ? 2 : 0);

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: "warn",
  paid: "ok",
  fulfilled: "sky",
  cancelled: "neutral",
  refunded: "danger",
};

/** The distinct lots behind one order, each with its cost floor (deduped, first wins). */
interface OrderLotCost {
  greenLotCode: string;
  costPerKgGreen: number | null;
}

function lotsForOrder(cogs: OrderCogsRow[], orderId: number): OrderLotCost[] {
  const seen = new Map<string, number | null>();
  for (const row of cogs) {
    if (row.orderId !== orderId) continue;
    if (!seen.has(row.greenLotCode)) {
      seen.set(row.greenLotCode, row.costPerKgGreen);
    }
  }
  return [...seen].map(([greenLotCode, costPerKgGreen]) => ({
    greenLotCode,
    costPerKgGreen,
  }));
}

export default async function OrdersPage() {
  const t = await getTranslations("orders");
  const [orders, cogs] = await Promise.all([getOrderBook(), getOrderCogs()]);

  const paid = orders.filter((o) => o.status === "paid");
  const pending = orders.filter((o) => o.status === "pending").length;
  const grossPaidCents = paid.reduce((acc, o) => acc + o.totalCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.orders")}
          value={num(orders.length)}
          sub={t("summary.ordersSub", { count: orders.length })}
          accent="forest"
          icon={ShoppingBag}
        />
        <Tile
          label={t("summary.paid")}
          value={num(paid.length)}
          sub={t("summary.paidSub")}
          accent="honey"
          icon={BadgeCheck}
        />
        <Tile
          label={t("summary.revenue")}
          value={money(grossPaidCents)}
          sub={t("summary.revenueSub")}
          accent="coffee"
          icon={DollarSign}
        />
        <Tile
          label={t("summary.pending")}
          value={num(pending)}
          sub={t("summary.pendingSub")}
          accent="sky"
          icon={Clock}
        />
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} cogs={cogs} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  cogs,
  t,
}: {
  order: OrderRow;
  cogs: OrderCogsRow[];
  t: Awaited<ReturnType<typeof getTranslations<"orders">>>;
}) {
  const lots = lotsForOrder(cogs, order.id);

  return (
    <article
      data-testid={`order-card-${order.id}`}
      className="glass-card perf-contain flex flex-col rounded-2xl p-5"
    >
      {/* Header: order id + customer + channel/status badges */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {t("card.order", { id: order.id })}
          </p>
          <p className="truncate text-xs text-muted-fg">
            {order.customerName ?? order.customerEmail ?? t("card.noCustomer")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Badge tone="neutral">{t(`channel.${order.channel}`)}</Badge>
          <Badge tone={STATUS_TONE[order.status]} dot>
            {t(`status.${order.status}`)}
          </Badge>
        </div>
      </div>

      {/* Money breakdown — server-computed (a tampered cart can't underpay). */}
      <dl className="mt-4 space-y-1.5 rounded-xl bg-paper/70 px-3 py-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-fg">{t("card.subtotal")}</dt>
          <dd className="tabular-nums text-ink">{money(order.subtotalCents)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-fg">{t("card.tax")}</dt>
          <dd className="tabular-nums text-ink">{money(order.dgiTaxCents)}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-line/70 pt-1.5">
          <dt className="font-medium text-ink">{t("card.total")}</dt>
          <dd className="font-display text-base font-bold tabular-nums text-ink">
            {money(order.totalCents)}
          </dd>
        </div>
      </dl>

      {/* Per-lot cost floor — NULL ⇒ flagged, never fabricated. */}
      <div className="mt-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
          {t("card.cogsTitle")}
        </p>
        <ul className="mt-1.5 space-y-1">
          {lots.map((lot) => (
            <li
              key={lot.greenLotCode}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate font-medium text-ink">
                {lot.greenLotCode}
              </span>
              <span className="shrink-0 tabular-nums text-muted-fg">
                {lot.costPerKgGreen == null
                  ? t("card.cogsUnknown")
                  : t("card.cogsValue", { price: perKg(lot.costPerKgGreen) })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer: line count + fiscal state */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line/60 pt-3">
        <span className="text-xs tabular-nums text-muted-fg">
          {t("card.lines")} · {t("card.linesValue", { count: order.lineCount })}
        </span>
        {order.dgiCufe ? (
          <span className="truncate text-xs font-medium text-forest">
            {t("card.fiscalFolio", { cufe: order.dgiCufe })}
          </span>
        ) : (
          <Badge tone="honey">{t("card.fiscalPending")}</Badge>
        )}
      </div>
    </article>
  );
}
