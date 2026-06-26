import { getTranslations } from "next-intl/server";
import { Coins, Receipt, Sprout, Users, Wallet } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, usd } from "@/lib/utils";
import { getCashRunway, getPreharvest } from "../data";

/**
 * /finance/runway — the cash-runway planner (P3-S17).
 *
 * The only place both ledgers net: AR due against committed cost, shown as a simple
 * waterfall, plus the pre-harvest financing picture (pre-sold volume against the open
 * por-obra labour liability) so the gap is visible before the picking crew shows up.
 * Server Component; the bars are GPU width transforms, no client JS.
 */

/** Compact $k label for the waterfall bars (keeps the figures distinct from the tiles). */
const compact = (v: number) => `$${(v / 1000).toFixed(1)}k`;

export default async function RunwayPage() {
  const t = await getTranslations("finance");
  const [runway, preharvest] = await Promise.all([getCashRunway(), getPreharvest()]);

  const max = Math.max(
    runway.arOutstandingUsd,
    runway.committedCostUsd,
    Math.abs(runway.netPositionUsd),
    1,
  );
  const w = (v: number) => `${Math.min(100, (Math.abs(v) / max) * 100)}%`;

  return (
    <div className="space-y-6">
      <PageHeader title={t("runway.title")} subtitle={t("runway.subtitle")} />

      <div className="glass-card grid grid-cols-3 gap-px overflow-hidden rounded-2xl">
        <Tile
          label={t("runway.net.label")}
          value={usd(runway.netPositionUsd)}
          accent={runway.netPositionUsd >= 0 ? "forest" : "cherry"}
          icon={Wallet}
        />
        <Tile
          label={t("runway.ar.label")}
          value={usd(runway.arOutstandingUsd)}
          accent="honey"
          icon={Coins}
        />
        <Tile
          label={t("runway.cost.label")}
          value={usd(runway.committedCostUsd)}
          accent="coffee"
          icon={Receipt}
        />
      </div>

      {/* waterfall */}
      <section className="glass-card rounded-2xl p-5">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("runway.waterfall.title")}
        </h2>
        <p className="mt-1 text-xs text-muted-fg">{t("runway.waterfall.sub")}</p>
        <div className="mt-4 space-y-4">
          <Bar
            label={t("runway.waterfall.arLabel")}
            value={compact(runway.arOutstandingUsd)}
            width={w(runway.arOutstandingUsd)}
            tone="bg-honey-300"
          />
          <Bar
            label={t("runway.waterfall.costLabel")}
            value={compact(runway.committedCostUsd)}
            width={w(runway.committedCostUsd)}
            tone="bg-coffee/60"
          />
          <Bar
            label={t("runway.waterfall.netLabel")}
            value={compact(runway.netPositionUsd)}
            width={w(runway.netPositionUsd)}
            tone={runway.netPositionUsd >= 0 ? "bg-forest" : "bg-cherry"}
          />
        </div>
      </section>

      {/* pre-harvest finance */}
      <section
        data-testid="preharvest"
        className="glass-card rounded-2xl p-5"
      >
        <h2 className="font-display text-base font-semibold text-ink">
          {t("runway.preharvest.title")}
        </h2>
        <p className="mt-1 text-xs text-muted-fg">{t("runway.preharvest.sub")}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PreCell
            icon={Sprout}
            label={t("runway.preharvest.presold")}
            value={t("runway.preharvest.presoldUnit", { kg: num(preharvest.presoldKg) })}
          />
          <PreCell
            icon={Users}
            label={t("runway.preharvest.contracts")}
            value={num(preharvest.activePorObraContracts)}
          />
          <PreCell
            icon={Coins}
            label={t("runway.preharvest.laborRate")}
            value={usd(preharvest.indicativeLaborRateUsd)}
          />
        </div>
      </section>
    </div>
  );
}

function Bar({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: string;
  width: string;
  tone: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="tabular-nums text-muted-fg">{value}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-paper/80">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width }}
          aria-hidden
        />
      </div>
    </div>
  );
}

function PreCell({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-paper/70 px-3 py-3">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-forest-100/70 text-forest">
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-2 text-[0.6875rem] uppercase tracking-wide text-muted-fg">
        {label}
      </p>
      <p className="font-display text-lg font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}
