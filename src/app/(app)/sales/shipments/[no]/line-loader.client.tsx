"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PackagePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import type { LoadableLine } from "@/app/(app)/sales/shipments/types";
import { addShipmentLineAction } from "@/app/(app)/sales/shipments/actions";

/**
 * Line loader — the building-phase island. Loads a contract line onto the shipment;
 * the write inserts a lot_shipments CLAIM first so the EXISTING prevent_oversell
 * trigger guards physical over-shipment (net_kg = bags × the shipment's bag weight).
 * The net-kg preview is arithmetic on the declared bag weight (no magic constant). On
 * success the route RSC re-reads (router.refresh) so the new line + moved ATP show.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `l_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function LineLoader({
  shipmentId,
  bagWeightKg,
  loadableLines,
}: {
  shipmentId: number;
  bagWeightKg: number;
  loadableLines: LoadableLine[];
}) {
  const t = useTranslations("shipments");
  const router = useRouter();

  const [lineId, setLineId] = useState<number | "">(
    loadableLines[0]?.contractLineId ?? "",
  );
  const [bags, setBags] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loadableLines.length === 0) {
    return (
      <p className="rounded-lg bg-paper/70 px-3 py-2 text-xs text-muted-fg">
        {t("lines.noLoadable")}
      </p>
    );
  }

  const netKg = Number.isFinite(bags) ? Math.max(0, bags) * bagWeightKg : 0;

  async function onAdd() {
    if (lineId === "") {
      setError(t("errors.lineRequired"));
      return;
    }
    setError(null);
    setPending(true);
    const result = await addShipmentLineAction({
      shipmentId,
      contractLineId: Number(lineId),
      bags,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="rounded-xl border border-forest/15 bg-forest/[0.03] p-4">
      <p className="mb-2 font-display text-sm font-semibold text-ink">
        {t("lines.addTitle")}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="ll-line">
            {t("lines.pickLine")}
          </label>
          <select
            id="ll-line"
            className={FIELD}
            value={lineId}
            onChange={(e) => setLineId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            {loadableLines.map((l) => (
              <option key={l.contractLineId} value={l.contractLineId}>
                {t("lines.lineOption", { lot: l.greenLotCode, kg: num(Math.round(l.kg)) })}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="ll-bags">
            {t("lines.bagsLabel")}
          </label>
          <input
            id="ll-bags"
            type="number"
            min={1}
            step="1"
            inputMode="numeric"
            className={FIELD}
            value={Number.isFinite(bags) ? bags : ""}
            onChange={(e) => setBags(Number(e.target.value))}
          />
        </div>

        <Button type="button" disabled={pending} onClick={onAdd} className="w-full sm:w-auto">
          <PackagePlus className="h-4 w-4" aria-hidden />
          {pending ? t("lines.adding") : t("lines.add")}
        </Button>
      </div>

      <p className="mt-2 text-xs tabular-nums text-muted-fg">
        {t("lines.netHint", {
          bags: num(Math.max(0, Math.round(bags))),
          bagWeight: num(bagWeightKg),
          netKg: num(Math.round(netKg)),
        })}
      </p>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry">
          {error}
        </p>
      )}
    </div>
  );
}
