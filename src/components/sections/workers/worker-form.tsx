"use client";

import { useActionState, useEffect } from "react";

import type { Worker } from "@/lib/types";
import { ATTENDANCE_STATUSES, WORKER_ROLES } from "@/lib/enums";
import { IDLE, type ActionState } from "@/lib/actions/workers";
import { Button } from "@/components/ui/button";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

type WorkerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function WorkerForm({
  worker,
  action,
  submitLabel,
  onDone,
  crews,
}: {
  worker?: Worker;
  action: WorkerAction;
  submitLabel: string;
  onDone: () => void;
  /** Crew names sourced LIVE from getCrews() by the RSC parent (no mock const). */
  crews: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  return (
    <form action={formAction} className="space-y-3">
      {worker && <input type="hidden" name="id" value={worker.id} />}

      <div className="space-y-1">
        <label className={LABEL} htmlFor="name">
          Name
        </label>
        <input
          id="name"
          name="name"
          defaultValue={worker?.name}
          placeholder="e.g. Rosa Quintero"
          className={FIELD}
        />
        {fieldError("name") && (
          <p className="text-xs text-cherry">{fieldError("name")}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="role">
            Role
          </label>
          <select id="role" name="role" defaultValue={worker?.role ?? ""} className={FIELD}>
            <option value="" disabled>
              Choose…
            </option>
            {WORKER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {fieldError("role") && (
            <p className="text-xs text-cherry">{fieldError("role")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="crew">
            Crew
          </label>
          <select id="crew" name="crew" defaultValue={worker?.crew ?? ""} className={FIELD}>
            <option value="" disabled>
              Choose…
            </option>
            {crews.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {fieldError("crew") && (
            <p className="text-xs text-cherry">{fieldError("crew")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="daily_rate_usd">
            Day rate (USD)
          </label>
          <input
            id="daily_rate_usd"
            name="daily_rate_usd"
            type="number"
            step="0.01"
            min="0"
            defaultValue={worker?.dailyRateUsd}
            placeholder="22"
            className={FIELD}
          />
          {fieldError("daily_rate_usd") && (
            <p className="text-xs text-cherry">{fieldError("daily_rate_usd")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="started_year">
            Started year
          </label>
          <input
            id="started_year"
            name="started_year"
            type="number"
            step="1"
            defaultValue={worker?.startedYear}
            placeholder="2015"
            className={FIELD}
          />
          {fieldError("started_year") && (
            <p className="text-xs text-cherry">{fieldError("started_year")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="attendance">
            Attendance
          </label>
          <select
            id="attendance"
            name="attendance"
            defaultValue={worker?.attendance ?? "present"}
            className={FIELD}
          >
            {ATTENDANCE_STATUSES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {fieldError("attendance") && (
            <p className="text-xs text-cherry">{fieldError("attendance")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            defaultValue={worker?.phone}
            placeholder="+507 6612-7741"
            className={FIELD}
          />
          {fieldError("phone") && (
            <p className="text-xs text-cherry">{fieldError("phone")}</p>
          )}
        </div>
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
