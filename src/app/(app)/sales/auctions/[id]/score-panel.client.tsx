"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import {
  recordAuctionResultAction,
  recordScoresheetAction,
} from "../actions";
import type { AuctionEntry } from "../data";

/**
 * ScorePanel — the per-entry interactive island: capture jury marks on a glass radial
 * dial (one juror × one attribute × a 0–100 mark, append-only) and, when the round is
 * decided, the money-shaped record-result write. The result stamps the clearing price,
 * seeds the auction_comps library, and books a reserve sale that REUSES the existing
 * auction reservation (no new claim) — so it is HUMAN-CONFIRMED (rail §7). A cleared
 * entry is read-only.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

/** A glass radial dial for a 0–100 mark — an SVG arc gauge over an accessible range. */
function ScoreDial({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const arc = pct * c;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            className="text-line/60"
          />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${c}`}
            className="text-forest transition-[stroke-dasharray] duration-300 ease-out motion-reduce:transition-none"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-2xl font-bold tabular-nums text-ink">
            {num(value, 1)}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.25}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full accent-forest"
      />
    </div>
  );
}

export function ScorePanel({ entry }: { entry: AuctionEntry }) {
  const t = useTranslations("auctions");
  const router = useRouter();
  const fieldId = useId();
  const currentYear = new Date().getFullYear();

  // jury-mark capture
  const [juror, setJuror] = useState("");
  const [attribute, setAttribute] = useState("");
  const [markScore, setMarkScore] = useState<number>(85);
  const [markPending, setMarkPending] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markAdded, setMarkAdded] = useState(false);

  // record-result (money-shaped)
  const [resultOpen, setResultOpen] = useState(false);
  const [juryScoreStr, setJuryScoreStr] = useState<string>(
    entry.panelFinalScore != null ? String(entry.panelFinalScore) : "",
  );
  const [clearingStr, setClearingStr] = useState<string>("");
  const [bidder, setBidder] = useState("");
  const [yearStr, setYearStr] = useState<string>(String(currentYear));
  const [resultPending, setResultPending] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);

  if (entry.sold) {
    return (
      <p className="rounded-xl bg-paper/70 px-3 py-2 text-xs text-muted-fg">
        {t("result.recorded")}
      </p>
    );
  }

  async function onAddMark() {
    setMarkError(null);
    setMarkAdded(false);
    setMarkPending(true);
    const result = await recordScoresheetAction({
      entryId: entry.entryId,
      juror,
      attribute,
      score: markScore,
      idempotencyKey: newKey(),
    });
    setMarkPending(false);
    if (result.ok) {
      setMarkAdded(true);
      setJuror("");
      setAttribute("");
      router.refresh();
    } else {
      setMarkError(result.error);
    }
  }

  async function onRecordResult() {
    setResultError(null);
    const clearing = Number(clearingStr);
    setResultPending(true);
    const result = await recordAuctionResultAction({
      entryId: entry.entryId,
      juryScore: juryScoreStr.trim() === "" ? null : Number(juryScoreStr),
      clearingPriceUsdPerKg: clearing,
      winningBidder: bidder.trim() === "" ? null : bidder,
      resultYear: yearStr.trim() === "" ? null : Number(yearStr),
      idempotencyKey: newKey(),
    });
    setResultPending(false);
    if (result.ok) {
      setResultOpen(false);
      router.refresh();
    } else {
      setResultError(result.error);
    }
  }

  const canAddMark =
    !markPending && juror.trim() !== "" && attribute.trim() !== "";
  const canRecord = !resultPending && Number(clearingStr) > 0;

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
        {t("score.heading")}
      </h3>

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr] sm:items-center">
        <ScoreDial
          value={markScore}
          onChange={setMarkScore}
          label={t("score.dialLabel")}
        />

        <div className="space-y-3">
          <div className="space-y-1">
            <label className={LABEL} htmlFor={`${fieldId}-juror`}>
              {t("score.jurorLabel")}
            </label>
            <input
              id={`${fieldId}-juror`}
              type="text"
              className={FIELD}
              placeholder={t("score.jurorPlaceholder")}
              value={juror}
              onChange={(e) => setJuror(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor={`${fieldId}-attr`}>
              {t("score.attributeLabel")}
            </label>
            <input
              id={`${fieldId}-attr`}
              type="text"
              className={FIELD}
              placeholder={t("score.attributePlaceholder")}
              value={attribute}
              onChange={(e) => setAttribute(e.target.value)}
            />
          </div>
        </div>
      </div>

      {markError && (
        <p
          role="alert"
          className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
        >
          {markError}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-forest">
          {markAdded ? t("score.added") : ""}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canAddMark}
            onClick={onAddMark}
          >
            {markPending ? t("score.adding") : t("score.submit")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setResultError(null);
              setResultOpen(true);
            }}
          >
            {t("result.open")}
          </Button>
        </div>
      </div>

      {/* money-shaped record-result confirm */}
      <Dialog
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        title={t("result.title")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("result.body", { lot: entry.greenLotCode })}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL} htmlFor={`${fieldId}-jury`}>
                {t("result.juryLabel")}
              </label>
              <input
                id={`${fieldId}-jury`}
                type="number"
                min={0}
                max={100}
                step="0.25"
                inputMode="decimal"
                className={FIELD}
                value={juryScoreStr}
                onChange={(e) => setJuryScoreStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor={`${fieldId}-clearing`}>
                {t("result.clearingLabel")}
              </label>
              <input
                id={`${fieldId}-clearing`}
                type="number"
                min={0}
                step="1"
                inputMode="decimal"
                className={FIELD}
                value={clearingStr}
                onChange={(e) => setClearingStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor={`${fieldId}-bidder`}>
                {t("result.bidderLabel")}
              </label>
              <input
                id={`${fieldId}-bidder`}
                type="text"
                className={FIELD}
                placeholder={t("result.bidderPlaceholder")}
                value={bidder}
                onChange={(e) => setBidder(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor={`${fieldId}-year`}>
                {t("result.yearLabel")}
              </label>
              <input
                id={`${fieldId}-year`}
                type="number"
                step="1"
                inputMode="numeric"
                className={FIELD}
                value={yearStr}
                onChange={(e) => setYearStr(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-fg">{t("result.irreversible")}</p>

          {resultError && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {resultError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setResultOpen(false)}
            >
              {t("result.cancel")}
            </Button>
            <Button type="button" disabled={!canRecord} onClick={onRecordResult}>
              {resultPending ? t("result.recording") : t("result.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
