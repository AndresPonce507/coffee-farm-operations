import { BadgeCheck, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import type { Disbursement } from "@/lib/db/payroll";

import { methodLabelEs, usd } from "./labels";

/**
 * PayPeriodDisbursementsSection — the append-only payment ledger (#disbursements).
 *
 * Every recorded payment for the period (Yappy / Nequi / ACH / signed-cash),
 * newest first — the family's "who's been paid" trail. Corrections are reversing
 * (negative-amount) rows, so the ledger is never edited in place; this section
 * just renders the record. Each payment links its worker to their /workers/[id]
 * dossier (the connectivity AC) so a payment is one tap from the person's full
 * pay history. A signed-cash row shows the dignity signature badge (the $0
 * signature trail for the unbanked crew).
 *
 * The page passes a workerId→name map (the ledger stores only ids); an unknown
 * id falls back to the id itself but STILL links to the dossier. Pure
 * presentation; es-PA-first.
 */
export interface PayPeriodDisbursementsSectionProps {
  disbursements: Disbursement[];
  workerNames: Record<string, string>;
}

export function PayPeriodDisbursementsSection({
  disbursements,
  workerNames,
}: PayPeriodDisbursementsSectionProps) {
  const t = useTranslations("payPeriod");
  return (
    <DossierSection
      id="disbursements"
      title={t("disbursements.title")}
      count={disbursements.length}
      empty={disbursements.length === 0}
      emptyLabel={t("disbursements.empty")}
    >
      <Card className="animate-rise overflow-hidden">
        <ul className="divide-y divide-white/50">
          {disbursements.map((d) => {
            const name = workerNames[d.workerId] ?? d.workerId;
            const isReversal = d.amountUsd < 0;
            return (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <EntityLink
                    kind="worker"
                    id={d.workerId}
                    name={name}
                    className="font-medium text-ink underline-offset-2 outline-none transition-colors hover:text-forest hover:underline focus-visible:text-forest focus-visible:underline"
                  >
                    {name}
                  </EntityLink>
                  <p className="flex items-center gap-1.5 text-xs text-muted-fg">
                    <span>{methodLabelEs(d.method)}</span>
                    {d.ref ? <span>· {d.ref}</span> : null}
                    {d.signatureRef ? (
                      <span
                        className="inline-flex items-center gap-1 text-forest"
                        title={t("disbursements.signedTitle")}
                      >
                        <PenLine className="h-3 w-3" aria-hidden="true" />
                        {t("disbursements.signed")}
                      </span>
                    ) : null}
                    <span className="text-muted-fg/70">· {d.disbursedAt}</span>
                  </p>
                </div>
                <span
                  className={
                    isReversal
                      ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-coffee-200/40 px-3 py-1 text-xs font-semibold tabular-nums text-coffee"
                      : "inline-flex shrink-0 items-center gap-1 rounded-full bg-forest-100 px-3 py-1 text-xs font-semibold tabular-nums text-forest"
                  }
                >
                  {!isReversal ? (
                    <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : null}
                  {usd(d.amountUsd)}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </DossierSection>
  );
}
