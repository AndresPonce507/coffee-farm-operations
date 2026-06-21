"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, ShieldAlert, ShieldX, SprayCan } from "lucide-react";

import { Button } from "@/components/ui/button";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100 disabled:opacity-50 disabled:pointer-events-none";
const LABEL = "text-xs font-medium text-muted-fg";

/** A plot the spray can be logged against. */
export interface PlotOption {
  id: string;
  name: string;
}

/** An applicator + whether they currently hold a VALID pesticide-handling cert.
 *  `certified` is computed server-side from v_worker_certs_valid (S1). */
export interface CertifiedApplicator {
  id: string;
  name: string;
  certified: boolean;
}

/**
 * SprayLogForm — the cert-gated spray-log form (P2-S12), the UI half of the slice's
 * keystone invariant. The DB `log_spray` RPC is the REAL fail-closed gate (a spray
 * is blocked at the data layer unless the applicator holds a valid cert and the
 * PHI/REI windows are respected). This form makes that gate VISIBLE and dignified:
 * an uncertified applicator is disabled in the picker, and if one is somehow
 * submitted the form refuses BEFORE the round-trip with a clear cert reason — the
 * field worker gets "you need a valid cert", not a cryptic DB error.
 *
 * When NO applicator on the crew holds a valid cert, the form says so plainly: the
 * hazardous work simply cannot be logged until someone is certified.
 *
 * World-class: glass-lite controls, AA contrast, `aria-live` error region, no
 * motion beyond focus rings (reduced-motion safe by construction).
 */
export function SprayLogForm({
  plots,
  applicators,
}: {
  plots: PlotOption[];
  applicators: CertifiedApplicator[];
}) {
  const [plotId, setPlotId] = useState(plots[0]?.id ?? "");
  const [product, setProduct] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const anyCertified = applicators.some((a) => a.certified);

  function isCertified(id: string): boolean {
    return applicators.find((a) => a.id === id)?.certified ?? false;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    setError(null);

    if (!product.trim()) {
      setError("A product is required.");
      return;
    }
    if (!workerId) {
      setError("Choose the applicator.");
      return;
    }
    // THE CERT GATE (UI half) — refuse an uncertified applicator before the
    // round-trip. The DB enforces the same, fail-closed; this is the dignified,
    // immediate refusal.
    if (!isCertified(workerId)) {
      const name = applicators.find((a) => a.id === workerId)?.name ?? "This worker";
      setError(
        `${name} does not hold a valid pesticide-handling certification — the spray cannot be logged.`,
      );
      return;
    }
    // A certified applicator: in this $0 mock app we surface a success state. The
    // real write goes through the log_spray RPC (cert + PHI/REI re-checked server-side).
    setDone(true);
  }

  return (
    <form data-testid="spray-form" onSubmit={onSubmit} className="space-y-4">
      {!anyCertified ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-cherry-200 bg-cherry-50 px-3 py-2.5 text-xs font-medium text-cherry"
        >
          <ShieldX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          No crew member holds a valid pesticide-handling cert — a spray cannot be
          logged until someone is certified.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={LABEL}>Plot</span>
          <select
            className={FIELD}
            value={plotId}
            onChange={(e) => setPlotId(e.target.value)}
          >
            {plots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={LABEL}>Product</span>
          <input
            className={FIELD}
            type="text"
            value={product}
            placeholder="e.g. Verdadero 600"
            onChange={(e) => setProduct(e.target.value)}
          />
        </label>

        <label className="space-y-1.5 sm:col-span-2">
          <span className={LABEL}>Applicator</span>
          <select
            className={FIELD}
            value={workerId}
            onChange={(e) => {
              setWorkerId(e.target.value);
              setError(null);
              setDone(false);
            }}
          >
            <option value="">Choose a certified applicator…</option>
            {applicators.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.certified}>
                {a.name}
                {a.certified ? " — certified" : " — no valid cert"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div aria-live="assertive" className="min-h-[1.25rem]">
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 text-xs font-medium text-cherry"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="flex items-center gap-2 text-xs font-medium text-forest">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Spray logged — PHI/REI windows stamped; the planner will respect them.
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={!anyCertified} className="inline-flex items-center gap-2">
        <SprayCan className="h-4 w-4" aria-hidden /> Log spray
      </Button>
    </form>
  );
}
