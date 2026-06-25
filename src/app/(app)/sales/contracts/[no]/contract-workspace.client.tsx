"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num, usd } from "@/lib/utils";
import {
  addContractLineAction,
  signContractAction,
} from "./actions";
import type { ContractDetail, ContractLine } from "./data";

/**
 * Contract workspace island — the interactive line editor + sign control on
 * /sales/contracts/[no] (the page stays a Server Component rendering the header +
 * status spine). Lines are sourced from the server prop and reconciled live via
 * router.refresh() after each write (the (app) is force-dynamic), so the ATP the picker
 * shows is always the trigger's hard answer — never an optimistic guess that could
 * disagree with prevent_oversell. The add form is draft-only; a differential contract
 * EXCLUDES reserve lots from the picker (the DB trigger _contract_line_basis_chk would
 * reject them — the keystone, mirrored in the UI). Signing is a human-confirmed,
 * irreversible legal instrument (rail §7/§9). Nothing here is driven by untrusted
 * inbound.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `l_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

const perKg = (v: number) => usd(v, v < 100 ? 2 : 0);

export function ContractWorkspace({ detail }: { detail: ContractDetail }) {
  const t = useTranslations("sales");
  const router = useRouter();

  const [signedOptimistic, setSignedOptimistic] = useState(false);
  const isDraft = !signedOptimistic && detail.status === "draft";

  const isDifferential = detail.pricingBasis === "differential";
  const isFixed = detail.pricingBasis === "fixed";

  // A differential contract can NEVER carry a reserve lot (the DB trigger rejects it),
  // so the picker excludes them — the UI mirror of the data-layer guard.
  const lotOptions = useMemo(
    () =>
      isDifferential
        ? detail.availableLots.filter((l) => l.regime !== "reserve")
        : detail.availableLots,
    [detail.availableLots, isDifferential],
  );
  const hadReserveExcluded =
    isDifferential &&
    detail.availableLots.some((l) => l.regime === "reserve");

  // add-line form state
  const [lotCode, setLotCode] = useState<string>(
    lotOptions[0]?.greenLotCode ?? "",
  );
  const [kgStr, setKgStr] = useState<string>("");
  const [unitPriceStr, setUnitPriceStr] = useState<string>("");
  const [diffStr, setDiffStr] = useState<string>("");
  const [monthStr, setMonthStr] = useState<string>("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // sign state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const selectedLot = lotOptions.find((l) => l.greenLotCode === lotCode) ?? null;
  const kg = kgStr.trim() === "" ? null : Number(kgStr);
  const atpAfter =
    selectedLot?.atpKg != null && kg != null && Number.isFinite(kg)
      ? selectedLot.atpKg - kg
      : null;

  const canAdd =
    !pending &&
    !!selectedLot &&
    kg != null &&
    Number.isFinite(kg) &&
    kg > 0 &&
    (!isDifferential || monthStr.trim() !== "");

  async function onAddLine() {
    if (!selectedLot) {
      setError(t("workspace.errors.lotRequired"));
      return;
    }
    setError(null);
    setPending(true);
    const result = await addContractLineAction({
      contractId: detail.contractId,
      greenLotCode: selectedLot.greenLotCode,
      kg: kg ?? 0,
      unitPrice: isFixed && unitPriceStr.trim() !== "" ? Number(unitPriceStr) : null,
      differentialCents:
        isDifferential && diffStr.trim() !== "" ? Number(diffStr) : null,
      iceCMonth: isDifferential ? monthStr : null,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setKgStr("");
      setUnitPriceStr("");
      setDiffStr("");
      setMonthStr("");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function onSign() {
    setSignError(null);
    setSigning(true);
    const result = await signContractAction({
      contractId: detail.contractId,
      idempotencyKey: newKey(),
    });
    setSigning(false);
    if (result.ok) {
      setSignedOptimistic(true);
      setConfirmOpen(false);
      router.refresh();
    } else {
      setSignError(result.error);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      {/* lines list */}
      <section className="glass-card rounded-2xl p-5">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("workspace.lines.title")}
        </h2>

        {detail.lines.length === 0 ? (
          <p className="mt-3 text-sm text-muted-fg">
            {t("workspace.lines.empty")}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {detail.lines.map((line) => (
              <LineRow key={line.id} line={line} t={t} />
            ))}
          </ul>
        )}
      </section>

      {/* add-line form + sign control */}
      <div className="space-y-6">
        {isDraft && (
          <section className="glass-card rounded-2xl p-5">
            <h2 className="font-display text-base font-semibold text-ink">
              {t("workspace.add.title")}
            </h2>

            {lotOptions.length === 0 ? (
              <p className="mt-3 text-sm text-muted-fg">
                {t("offers.publish.noLots")}
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {hadReserveExcluded && (
                  <p className="rounded-lg bg-honey-100/60 px-3 py-2 text-xs text-honey-700">
                    {t("workspace.add.reserveExcluded")}
                  </p>
                )}

                <div className="space-y-1">
                  <label className={LABEL} htmlFor="al-lot">
                    {t("workspace.add.lotLabel")}
                  </label>
                  <select
                    id="al-lot"
                    className={FIELD}
                    value={lotCode}
                    onChange={(e) => setLotCode(e.target.value)}
                  >
                    {lotOptions.map((l) => (
                      <option key={l.greenLotCode} value={l.greenLotCode}>
                        {l.greenLotCode}
                        {l.atpKg != null ? ` · ${num(Math.round(l.atpKg))} kg` : ""}
                      </option>
                    ))}
                  </select>
                  {selectedLot?.atpKg != null && (
                    <p className="text-xs text-muted-fg tabular-nums">
                      {t("workspace.add.atpLine", {
                        kg: num(Math.round(selectedLot.atpKg)),
                      })}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className={LABEL} htmlFor="al-kg">
                    {t("workspace.add.kgLabel")}
                  </label>
                  <input
                    id="al-kg"
                    type="number"
                    min={0}
                    step="1"
                    inputMode="decimal"
                    className={FIELD}
                    value={kgStr}
                    onChange={(e) => setKgStr(e.target.value)}
                  />
                  <p className="text-xs text-muted-fg">
                    {t("workspace.add.kgHint")}
                  </p>
                  {atpAfter != null && (
                    <p
                      className={
                        "text-xs tabular-nums " +
                        (atpAfter < 0 ? "font-medium text-cherry" : "text-forest")
                      }
                    >
                      {t("workspace.add.atpAfter", {
                        kg: num(Math.round(atpAfter)),
                      })}
                    </p>
                  )}
                </div>

                {isFixed && (
                  <div className="space-y-1">
                    <label className={LABEL} htmlFor="al-price">
                      {t("workspace.add.unitPriceLabel")}
                    </label>
                    <input
                      id="al-price"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      className={FIELD}
                      value={unitPriceStr}
                      onChange={(e) => setUnitPriceStr(e.target.value)}
                    />
                  </div>
                )}

                {isDifferential && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className={LABEL} htmlFor="al-diff">
                        {t("workspace.add.differentialLabel")}
                      </label>
                      <input
                        id="al-diff"
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        className={FIELD}
                        value={diffStr}
                        onChange={(e) => setDiffStr(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={LABEL} htmlFor="al-month">
                        {t("workspace.add.monthLabel")}
                      </label>
                      <input
                        id="al-month"
                        type="text"
                        className={FIELD}
                        placeholder={t("workspace.add.monthPlaceholder")}
                        value={monthStr}
                        onChange={(e) => setMonthStr(e.target.value.toUpperCase())}
                      />
                    </div>
                  </div>
                )}

                {error && (
                  <p
                    role="alert"
                    className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
                  >
                    {error}
                  </p>
                )}

                <div className="flex justify-end">
                  <Button type="button" disabled={!canAdd} onClick={onAddLine}>
                    <Plus className="h-4 w-4" aria-hidden />
                    {pending ? t("workspace.add.adding") : t("workspace.add.submit")}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* sign control (draft only) */}
        {isDraft && (
          <section className="glass-card rounded-2xl p-5">
            {detail.lines.length === 0 ? (
              <p className="text-sm text-muted-fg">{t("workspace.sign.needsLine")}</p>
            ) : (
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={() => {
                  setSignError(null);
                  setConfirmOpen(true);
                }}
              >
                <Lock className="h-4 w-4" aria-hidden />
                {t("workspace.sign.open")}
              </Button>
            )}
          </section>
        )}

        {signedOptimistic && (
          <p className="text-sm font-medium text-forest">
            {t("workspace.sign.signed")}
          </p>
        )}
      </div>

      {/* sign confirm — human-confirmed, irreversible legal instrument */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("workspace.sign.title")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("workspace.sign.body", {
              count: num(detail.lines.length),
              contract: detail.contractNo,
              buyer: detail.buyerName ?? "—",
            })}
          </p>
          <p className="text-xs text-muted-fg">{t("workspace.sign.irreversible")}</p>

          {signError && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {signError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {t("workspace.sign.cancel")}
            </Button>
            <Button type="button" disabled={signing} onClick={onSign}>
              {signing ? t("workspace.sign.signing") : t("workspace.sign.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function LineRow({
  line,
  t,
}: {
  line: ContractLine;
  t: ReturnType<typeof useTranslations>;
}) {
  const priceLabel =
    line.unitPrice != null
      ? t("workspace.lines.priceValue", { price: perKg(line.unitPrice) })
      : line.differentialCents != null
        ? t("workspace.lines.differential", {
            cents: num(line.differentialCents, 0),
          })
        : t("workspace.lines.unfixed");

  return (
    <li
      data-testid={`contract-line-${line.id}`}
      className="rounded-xl border border-line bg-paper/60 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-sm font-semibold text-ink">
            {line.greenLotCode}
          </p>
          <p className="text-xs tabular-nums text-muted-fg">
            {t("workspace.lines.kgValue", { kg: num(Math.round(line.kg)) })}
            {line.iceCMonth ? ` · ${line.iceCMonth}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium tabular-nums text-ink">{priceLabel}</p>
          {line.reservationId != null && (
            <Badge tone="forest" className="mt-1">
              {t("workspace.lines.reservation")}
            </Badge>
          )}
        </div>
      </div>
    </li>
  );
}
