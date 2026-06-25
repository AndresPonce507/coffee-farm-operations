import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileSignature, Gauge, Layers, Scale } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tile } from "@/components/ui/tile";
import { num, pct, usd } from "@/lib/utils";
import {
  getBuyers,
  getContracts,
  type ContractRow,
  type ContractStatus,
} from "./data";
import { CreateContract } from "./create-contract.client";

/**
 * /sales/contracts — the standards-based sales-contract board (P3-S1 trade trunk).
 *
 * Every contract lands here as a glass card carrying its status (draft → signed →
 * fixed → in_transit → delivered → closed), the buyer, the Incoterm + pricing basis,
 * total contracted volume, and the live fixation %. Each card links to the contract
 * workspace where lines are added (each claiming green inventory via prevent_oversell)
 * and the contract is signed.
 *
 * Server Component: the board reads the co-located contracts port; the only client JS
 * is the create-contract island at the top.
 */

const STATUS_TONE: Record<ContractStatus, BadgeTone> = {
  draft: "neutral",
  signed: "sky",
  fixed: "forest",
  in_transit: "honey",
  delivered: "ok",
  closed: "coffee",
  cancelled: "danger",
};

const IN_PROGRESS: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  "draft",
  "signed",
  "fixed",
]);

export default async function ContractsPage() {
  const t = await getTranslations("sales");
  const [contracts, buyers] = await Promise.all([getContracts(), getBuyers()]);

  const inProgress = contracts.filter((c) => IN_PROGRESS.has(c.status)).length;
  const totalKg = contracts.reduce((acc, c) => acc + c.totalKg, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("contracts.title")} subtitle={t("contracts.subtitle")}>
        <CreateContract buyers={buyers} />
      </PageHeader>

      <div className="glass-card grid grid-cols-1 gap-px overflow-hidden rounded-2xl sm:grid-cols-3">
        <Tile
          label={t("contracts.summary.total")}
          value={num(contracts.length)}
          sub={t("contracts.summary.totalSub")}
          accent="forest"
          icon={Gauge}
        />
        <Tile
          label={t("contracts.summary.open")}
          value={num(inProgress)}
          sub={t("contracts.summary.openSub")}
          accent="sky"
          icon={Layers}
        />
        <Tile
          label={t("contracts.summary.kg")}
          value={num(Math.round(totalKg))}
          sub={t("contracts.summary.kgSub")}
          accent="honey"
          icon={Scale}
        />
      </div>

      {contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={t("contracts.empty.title")}
          description={t("contracts.empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {contracts.map((c) => (
            <ContractCard key={c.contractNo} contract={c} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContractCard({
  contract,
  t,
}: {
  contract: ContractRow;
  t: Awaited<ReturnType<typeof getTranslations<"sales">>>;
}) {
  const fixationPct = contract.fixationPct * 100;

  return (
    <Link
      href={`/sales/contracts/${encodeURIComponent(contract.contractNo)}`}
      data-testid={`contract-card-${contract.contractNo}`}
      className="glass-card glass-hover perf-contain block rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {contract.contractNo}
          </p>
          <p className="truncate text-xs text-muted-fg">
            {contract.buyerName ?? "—"}
          </p>
        </div>
        <Badge tone={STATUS_TONE[contract.status]} dot>
          {t(`contracts.status.${contract.status}`)}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("contracts.card.incoterm")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {contract.incoterm}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("contracts.card.basis")}
          </p>
          <p className="text-sm font-medium text-ink">
            {t(`contracts.basis.${contract.pricingBasis}`)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("contracts.card.totalKg")}
          </p>
          <p className="font-display text-xl font-bold tabular-nums text-ink">
            {t("contracts.card.totalKgValue", {
              kg: num(Math.round(contract.totalKg)),
            })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("contracts.card.fixedValue")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {contract.fixedValue > 0 ? usd(contract.fixedValue) : "—"}
          </p>
        </div>
      </div>

      {/* Fixation progress */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[0.6875rem] uppercase tracking-wide text-muted-fg">
          <span>{t("contracts.card.fixation")}</span>
          <span className="tabular-nums">{pct(fixationPct)}</span>
        </div>
        <ProgressBar value={fixationPct} tone="forest" />
      </div>
    </Link>
  );
}
