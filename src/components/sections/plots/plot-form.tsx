"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";

import type { Plot } from "@/lib/types";
import { COFFEE_VARIETIES, PLOT_STATUSES } from "@/lib/enums";
import { IDLE, type ActionState } from "@/lib/actions/plots";
import { Button } from "@/components/ui/button";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

/** Status → its translation key under plots.status. */
const STATUS_KEY: Record<(typeof PLOT_STATUSES)[number], string> = {
  healthy: "healthy",
  watch: "watch",
  "at-risk": "atRisk",
};

type PlotAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function PlotForm({
  plot,
  action,
  submitLabel,
  onDone,
}: {
  plot?: Plot;
  action: PlotAction;
  submitLabel: string;
  onDone: () => void;
}) {
  const t = useTranslations("plots");
  const [state, formAction, pending] = useActionState(action, IDLE);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  return (
    <form action={formAction} className="space-y-3">
      {plot && <input type="hidden" name="id" value={plot.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="name">
            {t("form.name")}
          </label>
          <input
            id="name"
            name="name"
            defaultValue={plot?.name}
            placeholder={t("form.namePlaceholder")}
            className={FIELD}
          />
          {fieldError("name") && (
            <p className="text-xs text-cherry">{fieldError("name")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="block">
            {t("form.block")}
          </label>
          <input
            id="block"
            name="block"
            defaultValue={plot?.block}
            placeholder={t("form.blockPlaceholder")}
            className={FIELD}
          />
          {fieldError("block") && (
            <p className="text-xs text-cherry">{fieldError("block")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="variety">
            {t("form.variety")}
          </label>
          <select
            id="variety"
            name="variety"
            defaultValue={plot?.variety ?? ""}
            className={FIELD}
          >
            <option value="" disabled>
              {t("form.choose")}
            </option>
            {COFFEE_VARIETIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="status">
            {t("form.status")}
          </label>
          <select
            id="status"
            name="status"
            defaultValue={plot?.status ?? "healthy"}
            className={FIELD}
          >
            {PLOT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${STATUS_KEY[s]}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="area_ha">
            {t("form.areaHa")}
          </label>
          <input
            id="area_ha"
            name="area_ha"
            type="number"
            step="0.1"
            min="0"
            defaultValue={plot?.areaHa}
            className={FIELD}
          />
          {fieldError("area_ha") && (
            <p className="text-xs text-cherry">{fieldError("area_ha")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="altitude_masl">
            {t("form.altitudeMasl")}
          </label>
          <input
            id="altitude_masl"
            name="altitude_masl"
            type="number"
            defaultValue={plot?.altitudeMasl}
            className={FIELD}
          />
          {fieldError("altitude_masl") && (
            <p className="text-xs text-cherry">{fieldError("altitude_masl")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="trees">
            {t("form.trees")}
          </label>
          <input
            id="trees"
            name="trees"
            type="number"
            min="0"
            defaultValue={plot?.trees}
            className={FIELD}
          />
          {fieldError("trees") && (
            <p className="text-xs text-cherry">{fieldError("trees")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="shade_pct">
            {t("form.shadePct")}
          </label>
          <input
            id="shade_pct"
            name="shade_pct"
            type="number"
            min="0"
            max="100"
            defaultValue={plot?.shadePct}
            className={FIELD}
          />
          {fieldError("shade_pct") && (
            <p className="text-xs text-cherry">{fieldError("shade_pct")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="established_year">
            {t("form.established")}
          </label>
          <input
            id="established_year"
            name="established_year"
            type="number"
            defaultValue={plot?.establishedYear}
            className={FIELD}
          />
          {fieldError("established_year") && (
            <p className="text-xs text-cherry">
              {fieldError("established_year")}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="last_inspected">
            {t("form.lastInspected")}
          </label>
          <input
            id="last_inspected"
            name="last_inspected"
            type="date"
            defaultValue={plot?.lastInspected}
            className={FIELD}
          />
          {fieldError("last_inspected") && (
            <p className="text-xs text-cherry">
              {fieldError("last_inspected")}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="expected_yield_kg">
          {t("form.expectedYieldKg")}
        </label>
        <input
          id="expected_yield_kg"
          name="expected_yield_kg"
          type="number"
          min="0"
          defaultValue={plot?.expectedYieldKg}
          className={FIELD}
        />
        {fieldError("expected_yield_kg") && (
          <p className="text-xs text-cherry">
            {fieldError("expected_yield_kg")}
          </p>
        )}
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("form.saving") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
