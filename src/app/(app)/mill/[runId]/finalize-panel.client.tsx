"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Sprout } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num, pct, usd } from "@/lib/utils";
import type { MillRunFinalizeView } from "./data";
import { outturnFraction, scaPrep, scaPrepTone } from "./grade";
import { finalizeMillingRunAction, recordGreenGradeAction } from "./actions";

/**
 * The interactive islands in /mill/[runId] (the page stays a Server Component):
 *   • FinalizePanel — the green-out + grade form that mints the green lot. The SCA prep
 *     band previews LIVE from the defect counts (a UI courtesy mirroring the GENERATED
 *     column; the DB is the source of truth). The mint is GATED on a closed mass balance
 *     (the DB is the real wall — the form just disables the control) and a HUMAN confirm
 *     dialog (the money/mass-shaped, irreversible write — rail §7).
 *   • RegradePanel — a standalone append-only re-grade for a minted green lot.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

/** Parse a numeric field to a non-negative integer (defects / screen). */
function toInt(v: string): number {
  const x = Math.floor(Number(v));
  return Number.isFinite(x) && x > 0 ? x : 0;
}

export function FinalizePanel({ view }: { view: MillRunFinalizeView }) {
  const t = useTranslations("millFinalize");
  const balanceOk = view.balance?.balanceOk ?? false;
  const defaultGreen =
    view.balance?.greenOut != null
      ? String(view.balance.greenOut)
      : view.greenKgOut != null
        ? String(view.greenKgOut)
        : "";

  const [greenKgStr, setGreenKgStr] = useState(defaultGreen);
  const [cupStr, setCupStr] = useState("");
  const [location, setLocation] = useState("");
  const [costStr, setCostStr] = useState("");
  const [cat1Str, setCat1Str] = useState("0");
  const [cat2Str, setCat2Str] = useState("0");
  const [screenStr, setScreenStr] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintedCode, setMintedCode] = useState<string | null>(null);

  const greenKg = Number(greenKgStr);
  const cat1 = toInt(cat1Str);
  const cat2 = toInt(cat2Str);
  const band = scaPrep(cat1, cat2);
  const outturn = useMemo(
    () => (Number.isFinite(greenKg) ? outturnFraction(greenKg, view.parchmentKgIn) : null),
    [greenKg, view.parchmentKgIn],
  );

  const maxDefect = Math.max(cat1, cat2, 1);

  const canOpen =
    !pending &&
    mintedCode == null &&
    balanceOk &&
    Number.isFinite(greenKg) &&
    greenKg > 0 &&
    location.trim() !== "";

  async function onConfirm() {
    setError(null);
    setPending(true);
    const result = await finalizeMillingRunAction({
      runId: view.runId,
      greenKgOut: greenKg,
      cuppingScore: cupStr.trim() === "" ? null : Number(cupStr),
      location,
      cat1Defects: cat1,
      cat2Defects: cat2,
      screenSize: screenStr.trim() === "" ? null : toInt(screenStr),
      processingCostUsd: costStr.trim() === "" ? 0 : Number(costStr),
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setMintedCode(result.greenLotCode);
      setConfirmOpen(false);
    } else {
      setError(result.error);
    }
  }

  if (mintedCode) {
    return (
      <div
        data-testid="finalize-result"
        className="glass-card glass-forest rounded-2xl p-5"
      >
        <FinalizeResultBody code={mintedCode} band={band} outturn={outturn} t={t} />
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("form.title")}
      </h2>

      {/* green-out + outturn preview */}
      <div className="mt-4 space-y-1">
        <label className={LABEL} htmlFor="mf-green">
          {t("form.greenKgLabel")}
        </label>
        <input
          id="mf-green"
          type="number"
          min={0}
          step="0.1"
          inputMode="decimal"
          className={FIELD}
          value={greenKgStr}
          onChange={(e) => setGreenKgStr(e.target.value)}
        />
        <p className="text-xs tabular-nums text-muted-fg">
          {outturn == null
            ? t("form.outturnUnknown")
            : t("form.outturnPreview", { pct: pct(outturn * 100) })}
          <span className="ml-1">· {t("form.greenKgHint")}</span>
        </p>
      </div>

      {/* cupping + location */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="mf-cup">
            {t("form.cuppingLabel")}
          </label>
          <input
            id="mf-cup"
            type="number"
            min={0}
            step="0.25"
            inputMode="decimal"
            className={FIELD}
            value={cupStr}
            onChange={(e) => setCupStr(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className={LABEL} htmlFor="mf-cost">
            {t("form.costLabel")}
          </label>
          <input
            id="mf-cost"
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            className={FIELD}
            value={costStr}
            onChange={(e) => setCostStr(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <label className={LABEL} htmlFor="mf-location">
          {t("form.locationLabel")}
        </label>
        <input
          id="mf-location"
          type="text"
          className={FIELD}
          placeholder={t("form.locationPlaceholder")}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      {/* SCA grade — live preview from the defect counts */}
      <div className="mt-5 rounded-xl border border-forest/15 bg-forest/[0.04] p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">{t("grade.title")}</h3>
          <span data-testid="sca-preview">
            <Badge tone={scaPrepTone(band)} dot>
              {t(`grade.prep.${band}`)}
            </Badge>
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-fg">{t("grade.subtitle")}</p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <DefectField
            id="mf-cat1"
            label={t("grade.cat1Label")}
            value={cat1Str}
            onChange={setCat1Str}
          />
          <DefectField
            id="mf-cat2"
            label={t("grade.cat2Label")}
            value={cat2Str}
            onChange={setCat2Str}
          />
        </div>

        <div className="mt-3 space-y-1">
          <label className={LABEL} htmlFor="mf-screen">
            {t("grade.screenLabel")}
          </label>
          <input
            id="mf-screen"
            type="number"
            min={0}
            step="1"
            inputMode="numeric"
            className={FIELD}
            value={screenStr}
            onChange={(e) => setScreenStr(e.target.value)}
          />
        </div>

        {/* defect histogram — two GPU-width bars, text-labelled for AA */}
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-fg">
            {t("grade.histogramTitle")}
          </p>
          <HistBar
            label={t("grade.primary")}
            value={cat1}
            max={maxDefect}
            tone="bg-cherry"
          />
          <HistBar
            label={t("grade.secondary")}
            value={cat2}
            max={maxDefect}
            tone="bg-honey-700"
          />
          <p className="mt-1 text-xs tabular-nums text-muted-fg">
            {t("grade.totalDefects", { count: num(cat1 + cat2) })}
          </p>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
        >
          {error}
        </p>
      )}

      {!balanceOk && (
        <p className="mt-4 text-xs font-medium text-cherry">
          {t("form.blockedBalance")}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button type="button" disabled={!canOpen} onClick={() => setConfirmOpen(true)}>
          {t("form.mint")}
        </Button>
      </div>

      {/* irreversible, money/mass-shaped confirm */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("confirm.title")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("confirm.body", {
              kg: num(Number.isFinite(greenKg) ? Math.round(greenKg) : 0),
              lot: view.parchmentLotCode,
            })}
          </p>

          <dl className="space-y-2 rounded-xl bg-paper/70 px-3 py-3 text-sm">
            <ConfirmRow label={t("confirm.balanceRow")}>
              <Badge tone="forest" dot>
                {t("confirm.balanced")}
              </Badge>
            </ConfirmRow>
            <ConfirmRow label={t("confirm.gradeRow")}>
              <Badge tone={scaPrepTone(band)}>{t(`grade.prep.${band}`)}</Badge>
            </ConfirmRow>
            <ConfirmRow label={t("confirm.outturnRow")}>
              <span className="tabular-nums text-ink">
                {outturn == null ? "—" : pct(outturn * 100)}
              </span>
            </ConfirmRow>
          </dl>

          <p className="text-xs text-muted-fg">{t("confirm.irreversible")}</p>

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
              onClick={() => setConfirmOpen(false)}
            >
              {t("confirm.cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={onConfirm}>
              {pending ? t("confirm.minting") : t("confirm.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

type MillT = ReturnType<typeof useTranslations<"millFinalize">>;

function FinalizeResultBody({
  code,
  band,
  outturn,
  t,
}: {
  code: string;
  band: string;
  outturn: number | null;
  t: MillT;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-forest" aria-hidden />
        <h2 className="font-display text-base font-semibold text-ink">
          {t("result.title")}
        </h2>
      </div>
      <p className="mt-2 text-sm text-ink">
        {outturn == null
          ? t("result.mintedNoPct", { code })
          : t("result.mintedLine", { code, pct: pct(outturn * 100) })}
      </p>
      <p className="mt-1 text-sm text-muted-fg">
        {t("result.gradeLine", { prep: t(`grade.prep.${band}`) })}
      </p>
      <p className="mt-1 text-xs text-muted-fg">{t("result.costLine")}</p>
      <Link
        href={`/lots/${encodeURIComponent(code)}`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-forest transition-colors hover:text-forest-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <Sprout className="h-4 w-4" aria-hidden />
        {t("result.viewLot")}
      </Link>
    </>
  );
}

function ConfirmRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-fg">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DefectField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        step="1"
        inputMode="numeric"
        className={FIELD}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function HistBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
}) {
  const widthPct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-fg">{label}</span>
      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-line/60">
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 origin-left rounded-full ${tone} transition-[width] duration-300 ease-out`}
          style={{ width: `${widthPct}%` }}
        />
      </span>
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink">
        {num(value)}
      </span>
    </div>
  );
}

/* ───────────────────────────── re-grade island ───────────────────────────── */

export function RegradePanel({ greenLotCode }: { greenLotCode: string }) {
  const t = useTranslations("millFinalize");
  const [open, setOpen] = useState(false);
  const [cat1Str, setCat1Str] = useState("0");
  const [cat2Str, setCat2Str] = useState("0");
  const [screenStr, setScreenStr] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const cat1 = toInt(cat1Str);
  const cat2 = toInt(cat2Str);
  const band = scaPrep(cat1, cat2);

  async function onSave() {
    setError(null);
    setPending(true);
    const result = await recordGreenGradeAction({
      greenLotCode,
      cat1Defects: cat1,
      cat2Defects: cat2,
      screenSize: screenStr.trim() === "" ? null : toInt(screenStr),
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      setOpen(false);
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("result.regradeOpen")}
      </Button>
      {done && (
        <span className="ml-2 text-xs font-medium text-forest">
          {t("regrade.done")}
        </span>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title={t("regrade.title", { code: greenLotCode })}>
        <div className="space-y-4">
          <p className="text-sm text-muted-fg">{t("regrade.body")}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <DefectField
              id="rg-cat1"
              label={t("grade.cat1Label")}
              value={cat1Str}
              onChange={setCat1Str}
            />
            <DefectField
              id="rg-cat2"
              label={t("grade.cat2Label")}
              value={cat2Str}
              onChange={setCat2Str}
            />
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="rg-screen">
              {t("grade.screenLabel")}
            </label>
            <input
              id="rg-screen"
              type="number"
              min={0}
              step="1"
              inputMode="numeric"
              className={FIELD}
              value={screenStr}
              onChange={(e) => setScreenStr(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-paper/70 px-3 py-2.5">
            <span className="text-sm text-muted-fg">{t("grade.previewLabel")}</span>
            <Badge tone={scaPrepTone(band)} dot>
              {t(`grade.prep.${band}`)}
            </Badge>
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("regrade.cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={onSave}>
              {pending ? t("regrade.saving") : t("regrade.submit")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
