"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { EUDR_CUTOFF } from "@/lib/types";
import {
  declarePlotDeforestationFree,
  type EudrBasis,
} from "@/app/(app)/eudr/actions";

/** The documented evidence kinds + their human labels (mirrors the DB CHECK).
 *  'established-pre-cutoff' is a FACTUAL claim the DB can falsify — it's only
 *  valid when the plot was established on/before the 2020-12-31 EUDR cutoff, so
 *  the UI only offers it for pre-2020 plots (never even tempt the rejected path). */
const BASES: ReadonlyArray<{ value: EudrBasis; label: string; preCutoffOnly?: boolean }> = [
  { value: "established-pre-cutoff", label: "Established before 2020 cutoff", preCutoffOnly: true },
  { value: "satellite-monitoring", label: "Satellite monitoring" },
  { value: "field-survey", label: "Field survey" },
];

/** Cutoff YEAR derived from the EUDR_CUTOFF date SSOT (@/lib/types) — never a
 *  hard-coded magic number. A plot established in this year or before is eligible
 *  for the 'established-pre-cutoff' basis. */
const EUDR_CUTOFF_YEAR = new Date(EUDR_CUTOFF).getFullYear();

const SELECT =
  "h-8 rounded-lg border border-line bg-white/70 px-2 text-[12px] text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";

/**
 * DeclarePlotForm — the compact per-plot WRITE affordance inside the EUDR
 * dossier: a basis <select> + a "Declare deforestation-free" button. Rendered
 * only on UNdeclared origin-plot rows (the dossier gates it on !deforestationFree).
 *
 * It calls the `declarePlotDeforestationFree` Server Action; the verdict engine
 * (eudr_lot_status) is the SSOT, so a successful declaration revalidates the lot
 * + /eudr pages server-side and the badge/facts re-render. Errors (incl. the DB's
 * established-pre-cutoff / basis-required CHECK violations) come back as friendly
 * sentences and render inline — never a raw SQL string.
 */
export function DeclarePlotForm({
  plotId,
  establishedYear,
  lotCode,
  className,
}: {
  plotId: string;
  establishedYear: number;
  /** the green lot whose dossier page to revalidate after a write. */
  lotCode?: string;
  className?: string;
}) {
  const preCutoff = establishedYear <= EUDR_CUTOFF_YEAR;
  // Only offer 'established-pre-cutoff' for a pre-cutoff plot (established in
  // EUDR_CUTOFF_YEAR or before); the DB would reject it otherwise — surface the
  // option set the data layer will actually accept.
  const options = BASES.filter((b) => !b.preCutoffOnly || preCutoff);

  const [basis, setBasis] = useState<EudrBasis>(options[0].value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await declarePlotDeforestationFree(plotId, true, basis, lotCode);
      if (!res.ok) setError(res.error);
      // On success the action revalidates the page; the row re-renders WITHOUT
      // the form (deforestationFree is now true), so there's nothing to reset.
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid={`declare-form-${plotId}`}
      className={cn("mt-2 flex flex-wrap items-center gap-1.5", className)}
    >
      <label htmlFor={`basis-${plotId}`} className="sr-only">
        Deforestation-free basis for this plot
      </label>
      <select
        id={`basis-${plotId}`}
        value={basis}
        onChange={(e) => setBasis(e.target.value as EudrBasis)}
        disabled={pending}
        className={SELECT}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg bg-forest px-2.5 py-1 text-[12px] font-medium text-paper",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)] transition-all duration-200 ease-out",
          "hover:bg-forest-700 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100",
          "active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100",
        )}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <ShieldCheck className="h-3 w-3" aria-hidden />
        )}
        Declare deforestation-free
      </button>
      {error && (
        <p role="alert" className="w-full text-[11px] font-medium text-cherry">
          {error}
        </p>
      )}
    </form>
  );
}
