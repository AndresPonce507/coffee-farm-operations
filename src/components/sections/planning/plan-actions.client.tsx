"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, CloudRain, Leaf } from "lucide-react";

import {
  recordMaturationSignal,
  replanPasada,
  schedulePasada,
  type PlanResult,
} from "@/app/(app)/plan/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PasadaPlan, PlotReadiness, RipenessTarget } from "@/lib/types";

/**
 * PlanActions — the /plan write door (P2-S8). Without it the planner is a viewer:
 * the three Server Actions (schedule / re-plan / log maturation signal) are the
 * slice's headline interactive capability — "schedule a pasada that fires a task
 * onto the board" and "re-plan around a rain front" — and were previously reachable
 * from NO button. This client island wires each action through the shared
 * portal-fixed Dialog, mirroring the sibling write slices (harvests, processing).
 *
 * Thin leaf: HarvestPlanner stays a Server Component and passes the read-model rows
 * (the plot list + the active pasada plans) down as props, so this island holds only
 * the interactivity. Each form submits via useTransition, surfaces the PlanResult
 * error inline, and relies on the action's revalidatePath to re-render the calendar
 * and the /tasks board.
 *
 * World-class: glass action bar, the shared accessible Dialog (focus trap, Escape,
 * scroll-lock), AA-contrast fields on the paper canvas, pending states, reduced-
 * motion safe (only the Dialog's existing animate-rise, already neutralized).
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100 disabled:opacity-60";
const LABEL = "text-xs font-medium text-muted-fg";

const RIPENESS_BANDS: ReadonlyArray<{ value: RipenessTarget; label: string }> = [
  { value: "low", label: "Low — early pass" },
  { value: "medium", label: "Medium — ripe" },
  { value: "high", label: "High — peak ripe" },
];

type Mode = "schedule" | "replan" | "signal" | null;

/** Today as yyyy-mm-dd for sensible date-input defaults. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PlanActions({
  plots,
  plans,
}: {
  /** The plots to plan for (the readiness rows; id + name is all we need). */
  plots: ReadonlyArray<Pick<PlotReadiness, "plotId" | "plotName">>;
  /** The active pasada plans — the re-plan targets (carry their plot + pasada). */
  plans: ReadonlyArray<
    Pick<PasadaPlan, "id" | "plotId" | "plotName" | "season" | "pasadaNumber">
  >;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setMode(null);
    setError(null);
  };

  /** Run a Server Action; on ok close the dialog, else surface its error. */
  const run = (action: () => Promise<PlanResult>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) close();
      else setError(res.error);
    });
  };

  const hasPlots = plots.length > 0;
  const hasPlans = plans.length > 0;

  return (
    <>
      {/* Action bar — the three write doors the slice is named for. */}
      <div
        data-testid="plan-actions"
        className="flex flex-wrap items-center gap-2"
      >
        <Button
          variant="primary"
          size="sm"
          disabled={!hasPlots}
          onClick={() => setMode("schedule")}
        >
          <CalendarPlus className="h-4 w-4" aria-hidden />
          Schedule pasada
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPlans}
          onClick={() => setMode("replan")}
        >
          <CloudRain className="h-4 w-4" aria-hidden />
          Re-plan around rain
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPlots}
          onClick={() => setMode("signal")}
        >
          <Leaf className="h-4 w-4" aria-hidden />
          Log maturation signal
        </Button>
      </div>

      {/* Schedule a pasada → schedule_pasada (fires a task onto /tasks). */}
      <Dialog
        open={mode === "schedule"}
        onClose={close}
        title="Schedule a pasada"
      >
        <ScheduleForm
          plots={plots}
          pending={pending}
          error={error}
          onCancel={close}
          onSubmit={(input) => run(() => schedulePasada(input))}
        />
      </Dialog>

      {/* Re-plan a pass around a rain front → replan_pasada (append-only supersede). */}
      <Dialog open={mode === "replan"} onClose={close} title="Re-plan around rain">
        <ReplanForm
          plans={plans}
          pending={pending}
          error={error}
          onCancel={close}
          onSubmit={(input) => run(() => replanPasada(input))}
        />
      </Dialog>

      {/* Log a bloom / GDD / NDVI → record_maturation_signal (only phenology writer). */}
      <Dialog
        open={mode === "signal"}
        onClose={close}
        title="Log a maturation signal"
      >
        <SignalForm
          plots={plots}
          pending={pending}
          error={error}
          onCancel={close}
          onSubmit={(input) => run(() => recordMaturationSignal(input))}
        />
      </Dialog>
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Forms — each a small controlled form calling its Server Action.        */
/* ---------------------------------------------------------------------- */

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs font-medium text-cherry">
      {error}
    </p>
  );
}

function Actions({
  pending,
  onCancel,
  submitLabel,
  pendingLabel,
}: {
  pending: boolean;
  onCancel: () => void;
  submitLabel: string;
  pendingLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}

function ScheduleForm({
  plots,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  plots: ReadonlyArray<Pick<PlotReadiness, "plotId" | "plotName">>;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: {
    plotId: string;
    season: string;
    pasadaNumber: number;
    predictedReadyDate: string;
    ripenessTarget: RipenessTarget;
  }) => void;
}) {
  const [plotId, setPlotId] = useState("");
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [pasadaNumber, setPasadaNumber] = useState(1);
  const [date, setDate] = useState(todayISO());
  const [ripeness, setRipeness] = useState<RipenessTarget>("medium");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          plotId,
          season,
          pasadaNumber,
          predictedReadyDate: date,
          ripenessTarget: ripeness,
        });
      }}
    >
      <p className="rounded-xl bg-forest-50/70 px-3 py-2 text-xs text-forest-700 ring-1 ring-forest-100">
        Scheduling a pass fires a task onto the Tasks board for the picking crew.
      </p>
      <div className="space-y-1">
        <label className={LABEL} htmlFor="sched-plot">
          Plot
        </label>
        <select
          id="sched-plot"
          className={FIELD}
          required
          value={plotId}
          disabled={pending}
          onChange={(e) => setPlotId(e.target.value)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {plots.map((p) => (
            <option key={p.plotId} value={p.plotId}>
              {p.plotName}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="sched-season">
            Season
          </label>
          <input
            id="sched-season"
            className={FIELD}
            required
            value={season}
            disabled={pending}
            onChange={(e) => setSeason(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className={LABEL} htmlFor="sched-pasada">
            Pasada #
          </label>
          <input
            id="sched-pasada"
            type="number"
            min={1}
            step={1}
            className={FIELD}
            required
            value={pasadaNumber}
            disabled={pending}
            onChange={(e) => setPasadaNumber(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="sched-date">
            Predicted ready
          </label>
          <input
            id="sched-date"
            type="date"
            className={FIELD}
            required
            value={date}
            disabled={pending}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className={LABEL} htmlFor="sched-ripeness">
            Ripeness target
          </label>
          <select
            id="sched-ripeness"
            className={FIELD}
            value={ripeness}
            disabled={pending}
            onChange={(e) => setRipeness(e.target.value as RipenessTarget)}
          >
            {RIPENESS_BANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorLine error={error} />
      <Actions
        pending={pending}
        onCancel={onCancel}
        submitLabel="Schedule pasada"
        pendingLabel="Scheduling…"
      />
    </form>
  );
}

function ReplanForm({
  plans,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  plans: ReadonlyArray<
    Pick<PasadaPlan, "id" | "plotId" | "plotName" | "season" | "pasadaNumber">
  >;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: {
    plotId: string;
    season: string;
    pasadaNumber: number;
    newReadyDate: string;
    reason: string;
  }) => void;
}) {
  const [planId, setPlanId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState("rain front");

  const selected = plans.find((p) => String(p.id) === planId);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!selected) return;
        onSubmit({
          plotId: selected.plotId,
          season: selected.season,
          pasadaNumber: selected.pasadaNumber,
          newReadyDate: date,
          reason,
        });
      }}
    >
      <p className="rounded-xl bg-honey-100/50 px-3 py-2 text-xs text-honey-700 ring-1 ring-honey/30">
        Re-planning supersedes the current pass and appends a new version — the prior
        plan is preserved as history.
      </p>
      <div className="space-y-1">
        <label className={LABEL} htmlFor="replan-plan">
          Scheduled pass
        </label>
        <select
          id="replan-plan"
          className={FIELD}
          required
          value={planId}
          disabled={pending}
          onChange={(e) => setPlanId(e.target.value)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {plans.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.plotName} — Pasada {p.pasadaNumber} ({p.season})
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className={LABEL} htmlFor="replan-date">
          New ready date
        </label>
        <input
          id="replan-date"
          type="date"
          className={FIELD}
          required
          value={date}
          disabled={pending}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label className={LABEL} htmlFor="replan-reason">
          Reason
        </label>
        <input
          id="replan-reason"
          className={FIELD}
          required
          placeholder="e.g. rain front"
          value={reason}
          disabled={pending}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ErrorLine error={error} />
      <Actions
        pending={pending}
        onCancel={onCancel}
        submitLabel="Re-plan pass"
        pendingLabel="Re-planning…"
      />
    </form>
  );
}

function SignalForm({
  plots,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  plots: ReadonlyArray<Pick<PlotReadiness, "plotId" | "plotName">>;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: {
    plotId: string;
    bloomDate: string | null;
    gddAccumulated: number | null;
    ndviLatest: number | null;
  }) => void;
}) {
  const [plotId, setPlotId] = useState("");
  const [bloomDate, setBloomDate] = useState("");
  const [gdd, setGdd] = useState("");
  const [ndvi, setNdvi] = useState("");

  const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          plotId,
          bloomDate: orNull(bloomDate),
          gddAccumulated: numOrNull(gdd),
          ndviLatest: numOrNull(ndvi),
        });
      }}
    >
      <p className="rounded-xl bg-sky-100/50 px-3 py-2 text-xs text-sky ring-1 ring-sky/30">
        Log a bloom, a GDD update, or an NDVI observation — the readiness model
        re-derives from these inputs (leave a field blank to keep its prior value).
      </p>
      <div className="space-y-1">
        <label className={LABEL} htmlFor="signal-plot">
          Plot
        </label>
        <select
          id="signal-plot"
          className={FIELD}
          required
          value={plotId}
          disabled={pending}
          onChange={(e) => setPlotId(e.target.value)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {plots.map((p) => (
            <option key={p.plotId} value={p.plotId}>
              {p.plotName}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className={LABEL} htmlFor="signal-bloom">
          Bloom date
        </label>
        <input
          id="signal-bloom"
          type="date"
          className={FIELD}
          value={bloomDate}
          disabled={pending}
          onChange={(e) => setBloomDate(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="signal-gdd">
            GDD accumulated
          </label>
          <input
            id="signal-gdd"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            placeholder="e.g. 1200"
            className={FIELD}
            value={gdd}
            disabled={pending}
            onChange={(e) => setGdd(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className={LABEL} htmlFor="signal-ndvi">
            NDVI (0–1)
          </label>
          <input
            id="signal-ndvi"
            type="number"
            min={0}
            max={1}
            step="any"
            inputMode="decimal"
            placeholder="e.g. 0.7"
            className={FIELD}
            value={ndvi}
            disabled={pending}
            onChange={(e) => setNdvi(e.target.value)}
          />
        </div>
      </div>
      <ErrorLine error={error} />
      <Actions
        pending={pending}
        onCancel={onCancel}
        submitLabel="Log signal"
        pendingLabel="Logging…"
      />
    </form>
  );
}
