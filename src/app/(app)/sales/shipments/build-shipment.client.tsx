"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FIELD, LABEL } from "@/components/ui/form-field";
import type { BuildableContract } from "./data";
import { buildExportShipmentAction } from "./actions";

/**
 * Build-shipment form — one interactive island on the board. Mints a JC-S-NNNN
 * consignment from a signed contract (the picker only lists contracts past 'draft').
 * On success it refreshes the board so the new shipment card appears; the human then
 * opens it to load lines and issue the document pack. Empty contract list ⇒ a clear
 * "sign a contract first" hint, not a dead form.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function BuildShipment({ contracts }: { contracts: BuildableContract[] }) {
  const t = useTranslations("shipments");
  const router = useRouter();

  const [contractId, setContractId] = useState<number | "">(
    contracts[0]?.contractId ?? "",
  );
  const [port, setPort] = useState("Balboa, PA");
  const [bagWeight, setBagWeight] = useState(30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (contracts.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-5">
        <p className="text-sm text-muted-fg">{t("build.noContracts")}</p>
      </div>
    );
  }

  async function onBuild() {
    if (contractId === "") {
      setError(t("errors.contractRequired"));
      return;
    }
    setError(null);
    setPending(true);
    const result = await buildExportShipmentAction({
      contractId: Number(contractId),
      portOfLoading: port,
      bagWeightKg: bagWeight,
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
    <div className="glass-card rounded-2xl p-5">
      <div className="mb-3">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("build.title")}
        </h2>
        <p className="text-xs text-muted-fg">{t("build.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.5fr_1fr_auto] lg:items-end">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="bs-contract">
            {t("build.contractLabel")}
          </label>
          <select
            id="bs-contract"
            className={FIELD}
            value={contractId}
            onChange={(e) => setContractId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            {contracts.map((c) => (
              <option key={c.contractId} value={c.contractId}>
                {t("build.contractOption", {
                  contractNo: c.contractNo,
                  buyer: c.buyerName ?? "—",
                })}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="bs-port">
            {t("build.portLabel")}
          </label>
          <input
            id="bs-port"
            type="text"
            className={FIELD}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="bs-bagweight">
            {t("build.bagWeightLabel")}
          </label>
          <input
            id="bs-bagweight"
            type="number"
            min={1}
            step="1"
            inputMode="decimal"
            className={FIELD}
            value={Number.isFinite(bagWeight) ? bagWeight : ""}
            onChange={(e) => setBagWeight(Number(e.target.value))}
          />
        </div>

        <Button type="button" disabled={pending} onClick={onBuild} className="w-full lg:w-auto">
          <Plus className="h-4 w-4" aria-hidden />
          {pending ? t("build.submitting") : t("build.submit")}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
        >
          {error}
        </p>
      )}
    </div>
  );
}
