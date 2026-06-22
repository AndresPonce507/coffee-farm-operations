"use client";

import { useActionState } from "react";
import { CheckCircle2, MapPin } from "lucide-react";

import {
  assignStationAction,
  DRYING_IDLE,
  type DryingActionState,
} from "@/app/(app)/drying/actions";
import { Button } from "@/components/ui/button";
import { kg } from "@/lib/utils";
import type { StationOccupancy } from "@/lib/types";

/**
 * AssignStationForm — commits a drying lot to a station bed through the single
 * write door (`assignStationAction` → the `assign_drying_station` SECURITY DEFINER
 * RPC). The RPC closes any prior open assignment for the lot (a move) and opens a
 * new one; the `prevent_overcapacity` trigger fail-closes if the bed is full. Until
 * this form existed, a lot could never be placed on a bed from the app.
 *
 * Liquid-glass, reduced-motion-safe, WCAG-AA: matches the cherry-intake-form field
 * vocabulary. Each station option annotates its free headroom so the family picks a
 * bed that fits; a full bed's capacity error surfaces friendly (no raw SQL).
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

export function AssignStationForm({
  lots,
  stations,
  defaultLot,
  onDone,
}: {
  /** Lot codes currently resting (assignment candidates). */
  lots: string[];
  /** Drying stations with their live committed-vs-capacity headroom. */
  stations: StationOccupancy[];
  /** Pre-selected lot when opened from a specific lot card. */
  defaultLot?: string;
  /** Called after a successful assignment so the host (dialog) can offer to close. */
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    DryingActionState,
    FormData
  >(assignStationAction, DRYING_IDLE);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-4 py-4 text-center"
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-forest-50 text-forest ring-1 ring-forest-100">
          <CheckCircle2 className="h-7 w-7" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="font-display text-base font-semibold text-ink">
            Lot assigned
          </p>
          <p className="text-sm text-muted-fg">{state.message}</p>
        </div>
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl bg-forest-50/70 px-3 py-2 text-xs text-forest-700 ring-1 ring-forest-100">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Commits the lot to a bed — a full bed is refused, so committed weight can
          never exceed a station&rsquo;s capacity.
        </span>
      </p>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="assign-lotCode">
          Lot
        </label>
        <select
          id="assign-lotCode"
          name="lotCode"
          defaultValue={defaultLot ?? ""}
          required
          disabled={pending}
          className={FIELD}
          aria-invalid={fieldError("lotCode") ? true : undefined}
        >
          <option value="" disabled>
            Choose…
          </option>
          {lots.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        {fieldError("lotCode") && (
          <p className="text-xs text-cherry">{fieldError("lotCode")}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="assign-stationId">
          Station
        </label>
        <select
          id="assign-stationId"
          name="stationId"
          defaultValue=""
          required
          disabled={pending}
          className={FIELD}
          aria-invalid={fieldError("stationId") ? true : undefined}
        >
          <option value="" disabled>
            Choose…
          </option>
          {stations.map((s) => (
            <option key={s.stationId} value={s.stationId}>
              {s.name} · {kg(s.availableKg)} free
            </option>
          ))}
        </select>
        {fieldError("stationId") && (
          <p className="text-xs text-cherry">{fieldError("stationId")}</p>
        )}
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Assigning…" : "Assign to station"}
        </Button>
      </div>
    </form>
  );
}
