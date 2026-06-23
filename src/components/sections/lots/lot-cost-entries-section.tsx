import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import type { CostEntry } from "@/lib/types";

/**
 * LotCostEntriesSection — the `id="cost-entries"` section on the lot dossier.
 *
 * This section exists SOLELY so the `#cost-entries` anchor used by:
 *   - CostLotCard   (kind="lot"  anchor="cost-entries") in the costing page
 * resolves to a real rendered DOM node (DossierSection stamps
 * data-testid="section-cost-entries" + id="cost-entries" via scroll-mt-24).
 *
 * The ledger is the append-only `cost_entry` rows whose `target_kind="lot"` and
 * `target_code=this_lot_code`. These are the DIRECTLY-TAGGED journal entries for
 * this lot — overhead and agronomy costs that REACH this lot via the graph walk
 * are NOT in this ledger (they land on "farm" / "plot" targets). The display is
 * honest about this: it shows the raw signed amounts (a reversal is negative) and
 * carries a note that overhead/agronomy costs are visible in the cost build-up
 * above rather than duplicated here.
 *
 * Pure Server Component — takes already-fetched `CostEntry[]` as props (the page
 * owns the fetch via `getCostBreakdown({targetKind:"lot", targetCode: code})`).
 */

const fmtUsd = (n: number) =>
  n.toLocaleString("es-PA", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    signDisplay: "exceptZero",
  });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export function LotCostEntriesSection({ entries }: { entries: CostEntry[] }) {
  const t = useTranslations("lots");
  const ruleLabel: Record<string, string> = {
    "direct-labor": t("costEntries.ruleDirectLabor"),
    processing: t("costEntries.ruleProcessing"),
    agronomy: t("costEntries.ruleAgronomy"),
    overhead: t("costEntries.ruleOverhead"),
  };
  return (
    <DossierSection
      id="cost-entries"
      title={t("costEntries.title")}
      count={entries.length}
      empty={entries.length === 0}
      emptyLabel={t("costEntries.empty")}
    >
      <Card>
        <CardContent className="px-0 py-1">
          <p className="px-5 pb-2 pt-1 text-xs text-muted-fg">
            {t("costEntries.note")}
          </p>
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li
                key={e.id}
                data-testid={`cost-entry-row-${e.id}`}
                className="flex flex-wrap items-start gap-x-4 gap-y-0.5 px-5 py-3"
              >
                <span className="w-24 shrink-0 text-xs text-muted-fg">
                  {fmtDate(e.occurredAt)}
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                  {ruleLabel[e.allocationRule] ?? e.allocationRule}
                  {e.reversesId != null && (
                    <span className="ml-1.5 text-xs text-muted-fg">
                      {t("costEntries.reversal", { id: e.reversesId })}
                    </span>
                  )}
                </span>
                <span
                  className={`tabular-nums text-sm font-semibold ${e.amountUsd < 0 ? "text-cherry" : "text-forest"}`}
                >
                  {fmtUsd(e.amountUsd)}
                </span>
                {e.memo && (
                  <span className="w-full pl-28 text-xs text-muted-fg">
                    {e.memo}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
