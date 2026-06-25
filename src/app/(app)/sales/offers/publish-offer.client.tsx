"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Megaphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import { publishOfferAction } from "./actions";
import type { OfferableLot } from "./data";

/**
 * Publish-offer island — the ONE interactive control on /sales/offers (the board
 * stays a Server Component). The lot picker is sourced from the offerable lots, and
 * the regime is READ-ONLY: it follows the lot's grade, so a single-origin Reserve
 * coffee can never be offered on the commodity index from the UI (the keystone,
 * mirrored from the DB trigger). Asking price + kg are both optional — blank asking is
 * an auction/RFQ, blank kg offers everything available. A human submits the form;
 * nothing here is driven by untrusted inbound (rail §7).
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `o_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function PublishOffer({ lots }: { lots: OfferableLot[] }) {
  const t = useTranslations("sales");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [lotCode, setLotCode] = useState<string>(lots[0]?.greenLotCode ?? "");
  const [askingStr, setAskingStr] = useState<string>("");
  const [kgStr, setKgStr] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selected = lots.find((l) => l.greenLotCode === lotCode) ?? null;
  const isReserve = selected?.regime === "reserve";

  function reset() {
    setAskingStr("");
    setKgStr("");
    setError(null);
    setDone(false);
  }

  async function onSubmit() {
    if (!selected) {
      setError(t("offers.errors.lotRequired"));
      return;
    }
    setError(null);
    setPending(true);
    const asking = askingStr.trim() === "" ? null : Number(askingStr);
    const kg = kgStr.trim() === "" ? null : Number(kgStr);
    const result = await publishOfferAction({
      greenLotCode: selected.greenLotCode,
      regime: selected.regime,
      askingPrice: asking,
      kg,
      currency,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Megaphone className="h-4 w-4" aria-hidden />
        {t("offers.publish.open")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("offers.publish.title")}
      >
        {lots.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("offers.publish.noLots")}</p>
        ) : done ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-forest">
              {t("offers.publish.published")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("offers.publish.cancel")}
              </Button>
              <Button type="button" onClick={reset}>
                {t("offers.publish.another")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* lot picker */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="po-lot">
                {t("offers.publish.lotLabel")}
              </label>
              <select
                id="po-lot"
                className={FIELD}
                value={lotCode}
                onChange={(e) => setLotCode(e.target.value)}
              >
                {lots.map((l) => (
                  <option key={l.greenLotCode} value={l.greenLotCode}>
                    {l.greenLotCode}
                    {l.atpKg != null ? ` · ${num(Math.round(l.atpKg))} kg` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* read-only regime — follows the lot */}
            <div className="flex items-center gap-2">
              <Badge tone={isReserve ? "forest" : "neutral"} dot>
                {isReserve
                  ? t("offers.summary.reserve")
                  : t("offers.summary.commodity")}
              </Badge>
              <p className="text-xs text-muted-fg">{t("offers.publish.regimeNote")}</p>
            </div>

            {/* asking price (optional → auction/RFQ) */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="po-asking">
                {t("offers.publish.askingLabel")}
              </label>
              <input
                id="po-asking"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={FIELD}
                value={askingStr}
                onChange={(e) => setAskingStr(e.target.value)}
              />
              <p className="text-xs text-muted-fg">{t("offers.publish.askingHint")}</p>
            </div>

            {/* kg (optional → offer all) */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="po-kg">
                {t("offers.publish.kgLabel")}
              </label>
              <input
                id="po-kg"
                type="number"
                min={0}
                step="1"
                inputMode="decimal"
                className={FIELD}
                value={kgStr}
                onChange={(e) => setKgStr(e.target.value)}
              />
              <p className="text-xs text-muted-fg">{t("offers.publish.kgHint")}</p>
            </div>

            {/* currency */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="po-currency">
                {t("offers.publish.currencyLabel")}
              </label>
              <input
                id="po-currency"
                type="text"
                className={FIELD}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("offers.publish.cancel")}
              </Button>
              <Button type="button" disabled={pending} onClick={onSubmit}>
                {pending
                  ? t("offers.publish.publishing")
                  : t("offers.publish.submit")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
