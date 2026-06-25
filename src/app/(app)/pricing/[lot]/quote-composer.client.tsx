"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num, pct, usd } from "@/lib/utils";
import type { LotPricing } from "../data";
import {
  acceptQuoteAction,
  quoteCommodityPriceAction,
  quoteReservePriceAction,
} from "../actions";

/**
 * Quote composer — the ONE interactive island in /pricing/[lot] (the page stays a
 * Server Component). Regime-aware: a commodity lot drives a differential over the
 * live "C" (→ $/lb→$/kg via the server-passed convert_qty factor, NEVER a 2.2046
 * constant); a reserve lot shows the modeled build-up with an optional human
 * override. A margin-floor line the control physically can't cross — a UI courtesy;
 * the database is the real wall (the floor + regime-isolation triggers). Accept opens
 * a glass confirm that shows the ATP drop live, then commits via accept_quote (which
 * inserts the lot_reservations row the prevent_oversell trigger guards).
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

/** Per-kg money: 2dp under $100, 0dp above (reserve $/kg vs commodity ~$5). */
const perKg = (v: number) => usd(v, v < 100 ? 2 : 0);

export function QuoteComposer({ pricing }: { pricing: LotPricing }) {
  const t = useTranslations("pricing");
  const { row } = pricing;
  const isReserve = row.regime === "reserve";

  const atp = row.atpKg ?? 0;
  const [kgValue, setKgValue] = useState<number>(
    Math.max(1, Math.min(atp > 0 ? atp : 1, 30)),
  );
  const [currency] = useState<string>(pricing.settlementCurrency);
  const [fxRate] = useState<number>(1);

  // commodity controls
  const [differential, setDifferential] = useState<number>(
    pricing.defaultDifferentialUsdPerLb,
  );
  // reserve controls
  const [overrideStr, setOverrideStr] = useState<string>("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<number | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [buyer, setBuyer] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  // The margin floor in $/kg (cost × (1 + regime floor)). NULL ⇒ COGS unknown.
  const floorPerKg = useMemo<number | null>(() => {
    if (row.cogsPerKgGreen == null) return null;
    const f = isReserve ? pricing.reserveMinMarginPct : pricing.commodityMinMarginPct;
    return row.cogsPerKgGreen * (1 + f);
  }, [row.cogsPerKgGreen, isReserve, pricing.reserveMinMarginPct, pricing.commodityMinMarginPct]);

  // The modeled reserve price from the live build-up.
  const modeledReserve = useMemo<number | null>(() => {
    const m = pricing.reserveModel;
    if (m && row.cuppingScore != null) {
      return (
        m.baseUsdPerKg +
        m.coefficientUsdPerPoint * (row.cuppingScore - m.scorePivot) +
        m.scarcityUsdPerKg
      );
    }
    return row.indicativeUnitPrice;
  }, [pricing.reserveModel, row.cuppingScore, row.indicativeUnitPrice]);

  const override = overrideStr.trim() === "" ? null : Number(overrideStr);

  // The live unit price the composer would quote, per regime.
  const unitPrice = useMemo<number | null>(() => {
    if (isReserve) {
      return override != null && Number.isFinite(override) ? override : modeledReserve;
    }
    if (pricing.latestCPrice == null || pricing.lbPerKg == null) return null;
    return (pricing.latestCPrice + differential) * pricing.lbPerKg;
  }, [isReserve, override, modeledReserve, pricing.latestCPrice, pricing.lbPerKg, differential]);

  const margin =
    unitPrice != null && unitPrice > 0 && row.cogsPerKgGreen != null
      ? ((unitPrice - row.cogsPerKgGreen) / unitPrice) * 100
      : null;

  const belowFloor =
    floorPerKg != null && unitPrice != null && unitPrice < floorPerKg - 1e-9;

  // Commodity needs a live "C" mark to quote against.
  const commodityReady =
    !isReserve && pricing.latestContractMonth != null && pricing.latestCPrice != null;

  const canQuote =
    !pending &&
    !accepted &&
    unitPrice != null &&
    !belowFloor &&
    (isReserve || commodityReady) &&
    (kgValue > 0) &&
    (kgValue <= (atp || Infinity));

  async function onQuote() {
    setError(null);
    setPending(true);
    const result = isReserve
      ? await quoteReservePriceAction({
          greenLotCode: row.greenLotCode,
          kg: kgValue,
          overrideUsdPerKg: override,
          currency,
          fxRate,
          idempotencyKey: newKey(),
        })
      : await quoteCommodityPriceAction({
          greenLotCode: row.greenLotCode,
          kg: kgValue,
          contractMonth: pricing.latestContractMonth ?? "",
          differentialUsdPerLb: differential,
          currency,
          fxRate,
          idempotencyKey: newKey(),
        });
    setPending(false);
    if (result.ok) {
      setQuoteId(result.quoteId);
    } else {
      setError(result.error);
    }
  }

  async function onAccept() {
    if (quoteId == null) return;
    setAcceptError(null);
    setAccepting(true);
    const result = await acceptQuoteAction({
      quoteId,
      buyer,
      idempotencyKey: newKey(),
    });
    setAccepting(false);
    if (result.ok) {
      setAccepted(true);
      setConfirmOpen(false);
    } else {
      setAcceptError(result.error);
    }
  }

  const floorLine =
    floorPerKg != null
      ? t("composer.marginFloorLine", {
          price: perKg(floorPerKg),
          pct: pct((isReserve ? pricing.reserveMinMarginPct : pricing.commodityMinMarginPct) * 100),
        })
      : t("composer.cogsUnknownLine");

  return (
    <div className="glass-card rounded-2xl p-5">
      {/* kg */}
      <div className="space-y-1">
        <label className={LABEL} htmlFor="qc-kg">
          {t("composer.kgLabel")}
        </label>
        <input
          id="qc-kg"
          type="number"
          min={1}
          max={atp > 0 ? atp : undefined}
          step="1"
          inputMode="decimal"
          className={FIELD}
          value={Number.isFinite(kgValue) ? kgValue : ""}
          onChange={(e) => setKgValue(Number(e.target.value))}
        />
        <p className="text-xs text-muted-fg tabular-nums">
          {t("composer.atpLine", { kg: num(Math.round(atp)) })}
        </p>
      </div>

      {/* regime-specific control */}
      {isReserve ? (
        <div className="mt-4 space-y-1">
          <label className={LABEL} htmlFor="qc-override">
            {t("reserve.override")}
          </label>
          <input
            id="qc-override"
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            placeholder={
              modeledReserve != null ? perKg(modeledReserve) : undefined
            }
            className={FIELD}
            value={overrideStr}
            onChange={(e) => setOverrideStr(e.target.value)}
          />
          <p className="text-xs text-muted-fg">{t("reserve.overrideHint")}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-1">
          <label className={LABEL} htmlFor="qc-diff">
            {t("commodity.differential")}
          </label>
          <input
            id="qc-diff"
            type="range"
            min={Math.max(0, floorPerKg != null && pricing.lbPerKg && pricing.latestCPrice != null ? floorPerKg / pricing.lbPerKg - pricing.latestCPrice : 0)}
            max={Math.max(1.5, differential + 1)}
            step="0.01"
            className="w-full accent-forest"
            value={differential}
            onChange={(e) => setDifferential(Number(e.target.value))}
            aria-label={t("commodity.differential")}
            disabled={!commodityReady}
          />
          <p className="text-xs font-medium text-forest tabular-nums">
            {t("commodity.differentialValue", { value: usd(differential, 2) })}
          </p>
        </div>
      )}

      {/* live price + margin readout */}
      <div className="mt-4 rounded-xl bg-paper/70 px-3 py-3">
        <p className="font-display text-xl font-bold tabular-nums text-ink">
          {unitPrice == null
            ? t("commodity.noMark")
            : t("composer.indicativeLine", { price: perKg(unitPrice) })}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-muted-fg">
          {margin == null
            ? t("composer.marginUnknownLine")
            : t("composer.marginLine", { pct: pct(margin) })}
        </p>
        <p
          className={
            "mt-1 text-xs tabular-nums " +
            (belowFloor ? "font-medium text-cherry" : "text-muted-fg")
          }
        >
          {floorLine}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
        >
          {error}
        </p>
      )}

      {/* actions */}
      <div className="mt-4 flex items-center justify-end gap-2">
        {quoteId == null ? (
          <Button type="button" disabled={!canQuote} onClick={onQuote}>
            {pending ? t("composer.quoting") : t("composer.quote")}
          </Button>
        ) : accepted ? (
          <span className="text-sm font-medium text-forest">
            {t("accept.accepted")}
          </span>
        ) : (
          <>
            <span className="mr-auto text-xs font-medium text-forest">
              {t("composer.quoted")}
            </span>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setAcceptError(null);
                setConfirmOpen(true);
              }}
            >
              {t("accept.open")}
            </Button>
          </>
        )}
      </div>

      {/* accept confirm — money-shaped, human-confirmed; shows the ATP drop live */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("accept.title")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("accept.body", { kg: num(kgValue), lot: row.greenLotCode })}
          </p>

          <div className="flex items-center justify-between rounded-xl bg-paper/70 px-3 py-3 text-sm">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                {t("accept.atpBefore")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-ink">
                {num(Math.round(atp))}
              </p>
            </div>
            <span aria-hidden className="text-muted-fg">
              →
            </span>
            <div className="text-right">
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                {t("accept.atpAfter")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-forest">
                {num(Math.max(0, Math.round(atp - kgValue)))}
              </p>
              <p className="text-[0.625rem] text-muted-fg">{t("accept.atpUnit")}</p>
            </div>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="qc-buyer">
              {t("accept.buyerLabel")}
            </label>
            <input
              id="qc-buyer"
              type="text"
              className={FIELD}
              placeholder={t("accept.buyerPlaceholder")}
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-fg">{t("accept.irreversible")}</p>

          {acceptError && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {acceptError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {t("accept.cancel")}
            </Button>
            <Button
              type="button"
              disabled={accepting || buyer.trim() === ""}
              onClick={onAccept}
            >
              {accepting ? t("accept.accepting") : t("accept.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
