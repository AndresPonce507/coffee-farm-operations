"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { today } from "@/lib/utils";
import { recordFxRateAction } from "./actions";

/**
 * The ONE interactive island in /margins (the board stays a Server Component):
 * <RecordFxRateButton> opens the manual FX-rate form and appends through
 * `record_fx_rate` — the canonical rate-book writer (rail §6). This is the no-cost
 * fallback to the free ECB daily feed: a deliberate, human-entered figure, never
 * driven by untrusted inbound (rail §7). It records a reference rate, not an inventory
 * commitment, so on success it just calls router.refresh() to re-read the book.
 *
 * Errors surface verbatim from the action (author-written guard copy + clean canned
 * structural copy) in an assertive alert — never a raw SQLSTATE.
 */

const SOURCES = ["manual", "ecb"] as const;
type Source = (typeof SOURCES)[number];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `fx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function RecordFxRateButton() {
  const t = useTranslations("margins");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState<string>(today());
  const [base, setBase] = useState<string>("");
  const [quote, setQuote] = useState<string>("USD");
  const [rate, setRate] = useState<string>("");
  const [source, setSource] = useState<Source>("manual");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setError(null);
    setDone(false);
    setAsOf(today());
    setBase("");
    setQuote("USD");
    setRate("");
    setSource("manual");
  }

  async function onSubmit() {
    setError(null);
    setPending(true);
    const result = await recordFxRateAction({
      asOf: asOf.trim(),
      base: base.trim(),
      quote: quote.trim(),
      rate: rate.trim() === "" ? NaN : Number(rate),
      source,
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
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {t("fx.record")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("form.title")}>
        <div className="space-y-4">
          <p className="text-xs text-muted-fg">{t("form.intro")}</p>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="fx-asof">
              {t("form.asOfLabel")}
            </label>
            <input
              id="fx-asof"
              type="date"
              className={FIELD}
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="fx-base">
                {t("form.baseLabel")}
              </label>
              <input
                id="fx-base"
                type="text"
                autoCapitalize="characters"
                className={FIELD}
                placeholder={t("form.basePlaceholder")}
                value={base}
                onChange={(e) => setBase(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="fx-quote">
                {t("form.quoteLabel")}
              </label>
              <input
                id="fx-quote"
                type="text"
                autoCapitalize="characters"
                className={FIELD}
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="fx-rate">
              {t("form.rateLabel")}
            </label>
            <input
              id="fx-rate"
              type="number"
              min={0}
              step="0.0001"
              inputMode="decimal"
              className={FIELD}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            <p className="text-xs text-muted-fg">{t("form.rateHint")}</p>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="fx-source">
              {t("form.sourceLabel")}
            </label>
            <select
              id="fx-source"
              className={FIELD}
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
            >
              <option value="manual">{t("form.sourceManual")}</option>
              <option value="ecb">{t("form.sourceEcb")}</option>
            </select>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}
          {done && (
            <p
              role="status"
              className="rounded-lg bg-forest-100 px-3 py-2 text-xs font-medium text-forest"
            >
              {t("form.recorded")}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("form.cancel")}
            </Button>
            <Button type="button" disabled={pending || done} onClick={onSubmit}>
              {pending ? t("form.submitting") : t("form.submit")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
