"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, Calculator } from "lucide-react";

import { num, pct } from "@/lib/utils";

/**
 * YieldCalculator — a NO-WRITE display island.
 *
 * Projects a parchment lot through the dry mill (× outturn) and the roaster
 * (× shrinkage) using the house yield factors. Pure ratio math in kilograms only:
 * there is NO lb↔kg conversion here, so the "never hardcode 2.2046" rail is honoured
 * trivially (no unit conversion happens at all). Nothing it computes touches the
 * database — the real milling/roasting runs post their own measured mass in
 * P3-S7..S10, where the conservation guard balances every gram. This is a planning
 * estimate, clearly labelled as such.
 */
export function YieldCalculator({
  millOutturn,
  roastShrinkage,
}: {
  millOutturn: number;
  roastShrinkage: number;
}) {
  const t = useTranslations("yields");
  const inputId = useId();
  const [parchmentKg, setParchmentKg] = useState(1000);

  const safeIn = Number.isFinite(parchmentKg) && parchmentKg > 0 ? parchmentKg : 0;
  const greenKg = safeIn * millOutturn;
  const roastedKg = greenKg * roastShrinkage;

  return (
    <div
      data-testid="yield-calculator"
      className="glass-card perf-contain rounded-2xl p-5"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/50 bg-forest-100/70 text-forest shadow-sm">
          <Calculator className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="font-display text-base font-semibold text-ink">
            {t("calc.title")}
          </p>
          <p className="text-xs text-muted-fg">{t("calc.subtitle")}</p>
        </div>
      </div>

      {/* Input — parchment kg */}
      <div className="mt-5">
        <label
          htmlFor={inputId}
          className="text-xs uppercase tracking-wide text-muted-fg"
        >
          {t("calc.inputLabel")}
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id={inputId}
            type="number"
            min={0}
            inputMode="decimal"
            value={Number.isFinite(parchmentKg) ? parchmentKg : ""}
            onChange={(e) => setParchmentKg(e.target.valueAsNumber)}
            className="w-36 rounded-xl border border-line bg-paper/70 px-3 py-2 text-lg font-semibold tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
          />
          <span className="text-sm font-medium text-muted-fg">
            {t("calc.unit")}
          </span>
        </div>
      </div>

      {/* Projection chain: parchment → green → roasted */}
      <div className="mt-5 space-y-2">
        <Step
          testid="calc-green"
          label={t("calc.greenLabel")}
          value={`${num(Math.round(greenKg))} ${t("calc.unit")}`}
          hint={t("calc.greenHint", { pct: pct(millOutturn * 100) })}
          tone="forest"
        />
        <div className="flex justify-center" aria-hidden>
          <ArrowDown className="h-4 w-4 text-muted-fg" />
        </div>
        <Step
          testid="calc-roasted"
          label={t("calc.roastedLabel")}
          value={`${num(Math.round(roastedKg))} ${t("calc.unit")}`}
          hint={t("calc.roastedHint", { pct: pct(roastShrinkage * 100) })}
          tone="coffee"
        />
      </div>

      <p className="mt-4 text-[0.6875rem] leading-relaxed text-muted-fg">
        {t("calc.note")}
      </p>
    </div>
  );
}

function Step({
  testid,
  label,
  value,
  hint,
  tone,
}: {
  testid: string;
  label: string;
  value: string;
  hint: string;
  tone: "forest" | "coffee";
}) {
  const ring =
    tone === "forest"
      ? "border-forest/15 bg-forest/[0.04]"
      : "border-coffee/15 bg-coffee/[0.04]";
  return (
    <div
      data-testid={testid}
      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${ring}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-[0.6875rem] text-muted-fg">{hint}</p>
      </div>
      <p className="font-display text-lg font-bold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
