"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ShieldAlert, ShieldX, SprayCan } from "lucide-react";

import { Button } from "@/components/ui/button";
import { refreshAfterSpray } from "@/app/(app)/scouting/actions";
import { logSpray, type SprayStore } from "@/lib/db/commands/logSpray";
import type {
  CertifiedApplicator,
  PlotOption,
} from "@/lib/db/ipm-applicators";
import { uuidv7 } from "@/lib/offline/uuidv7";

// Domain types live in the lib read-port (`@/lib/db/ipm-applicators`); re-exported
// here for the existing consumers/tests that import them from the form.
export type { CertifiedApplicator, PlotOption };

const FIELD =
  "h-11 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100 disabled:opacity-50 disabled:pointer-events-none";
const LABEL = "text-xs font-medium text-muted-fg";

/** ISO-ish local datetime (yyyy-MM-ddTHH:mm) for the applied-at default = now. */
function nowLocalDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * The default write store — the real browser Supabase client, lazily built so the
 * cert-gate render/refusal tests never touch the network (they never submit, or
 * inject their own `store`). Production mounts pass no `store`, so a certified
 * submit drives the real `log_spray` SECURITY DEFINER RPC.
 */
async function defaultStore(): Promise<SprayStore> {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient() as unknown as SprayStore;
}

/**
 * SprayLogForm — the cert-gated spray-log form (P2-S12), the UI half of the slice's
 * keystone invariant AND its write door. The DB `log_spray` RPC is the REAL
 * fail-closed gate (a spray is blocked at the data layer unless the applicator holds
 * a valid cert and the PHI/REI windows are respected); this form makes that gate
 * VISIBLE — an uncertified applicator is disabled in the picker and refused BEFORE
 * the round-trip — and then actually WRITES: it collects the PHI/REI/active-ingredient
 * /applied-at dossier the RPC requires, mints an exactly-once idempotency key, calls
 * the real `log_spray` command, and only declares success on a returned spray id.
 * A DB cert/PHI/REI refusal surfaces in the error region, never as a fake success.
 *
 * When NO applicator on the crew holds a valid cert, the form says so plainly: the
 * hazardous work simply cannot be logged until someone is certified.
 *
 * World-class: glass-lite controls, AA contrast on cream, glove-friendly 44px tap
 * targets, `aria-live` error region, no motion beyond focus rings (reduced-motion
 * safe by construction).
 */
export function SprayLogForm({
  plots,
  applicators,
  store,
}: {
  plots: PlotOption[];
  applicators: CertifiedApplicator[];
  /** Injectable write port (tests pass a spy; production omits → real client). */
  store?: SprayStore;
}) {
  const [plotId, setPlotId] = useState(plots[0]?.id ?? "");
  const [product, setProduct] = useState("");
  const [activeIngredient, setActiveIngredient] = useState("");
  const [phiDays, setPhiDays] = useState("");
  const [reiHours, setReiHours] = useState("");
  const [appliedAt, setAppliedAt] = useState(() => nowLocalDatetime());
  const [workerId, setWorkerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  // Stable per-mount device identity + a monotonic per-submit sequence: the
  // (device_id, device_seq) causal-ordering key the offline write contract reserves
  // (P2-S0). The idempotency key is the exactly-once anchor — stable across one
  // submit so a double-tap dedupes in the RPC, re-minted after a success so the next
  // distinct spray is its own event.
  const deviceId = useRef(uuidv7());
  const deviceSeq = useRef(0);
  const idempotencyKey = useRef(uuidv7());

  const anyCertified = applicators.some((a) => a.certified);

  function isCertified(id: string): boolean {
    return applicators.find((a) => a.id === id)?.certified ?? false;
  }

  const onSubmit = useCallback(
    async (e: FormEvent) => {
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
        const name =
          applicators.find((a) => a.id === workerId)?.name ?? "This worker";
        setError(
          `${name} does not hold a valid pesticide-handling certification — the spray cannot be logged.`,
        );
        return;
      }

      // A certified applicator: drive the REAL write door. `log_spray` re-checks
      // cert + PHI/REI server-side, fail-closed; a refusal comes back as a labelled
      // error, never a faked success.
      setPending(true);
      try {
        const writeStore = store ?? (await defaultStore());
        deviceSeq.current += 1;
        const result = await logSpray(writeStore, {
          plotId,
          product,
          activeIngredient,
          phiDays,
          reiHours,
          appliedAt,
          workerId,
          deviceId: deviceId.current,
          deviceSeq: deviceSeq.current,
          idempotencyKey: idempotencyKey.current,
        });

        if (result.ok) {
          setDone(true);
          // Mint a fresh exactly-once anchor so the next distinct spray is its own
          // event; a same-render double-submit reused the prior key and deduped.
          idempotencyKey.current = uuidv7();
          // Best-effort: bust the cross-tab RSC caches (PHI gate on Plan, Scouting,
          // Map, Satellite, plot listing + dossier) so the new spray shows on the next
          // navigation. Fire-and-forget — never block or fail the offline-safe write.
          void refreshAfterSpray().catch(() => {});
        } else {
          const firstFieldError = result.errors
            ? Object.values(result.errors)[0]
            : undefined;
          setError(
            result.message ??
              firstFieldError ??
              "The spray could not be logged.",
          );
        }
      } catch {
        setError("Could not reach the log — check your connection and retry.");
      } finally {
        setPending(false);
      }
    },
    [
      product,
      workerId,
      applicators,
      store,
      plotId,
      activeIngredient,
      phiDays,
      reiHours,
      appliedAt,
    ],
  );

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
            disabled={pending}
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
            disabled={pending}
            placeholder="e.g. Verdadero 600"
            onChange={(e) => setProduct(e.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <span className={LABEL}>Active ingredient</span>
          <input
            className={FIELD}
            type="text"
            value={activeIngredient}
            disabled={pending}
            placeholder="e.g. cyproconazole"
            onChange={(e) => setActiveIngredient(e.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <span className={LABEL}>Applied at</span>
          <input
            className={FIELD}
            type="datetime-local"
            value={appliedAt}
            disabled={pending}
            onChange={(e) => setAppliedAt(e.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <span className={LABEL}>PHI (pre-harvest interval, days)</span>
          <input
            className={FIELD}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={phiDays}
            disabled={pending}
            placeholder="e.g. 21"
            onChange={(e) => setPhiDays(e.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <span className={LABEL}>REI (re-entry interval, hours)</span>
          <input
            className={FIELD}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={reiHours}
            disabled={pending}
            placeholder="e.g. 12"
            onChange={(e) => setReiHours(e.target.value)}
          />
        </label>

        <label className="space-y-1.5 sm:col-span-2">
          <span className={LABEL}>Applicator</span>
          <select
            className={FIELD}
            value={workerId}
            disabled={pending}
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
          <p
            role="status"
            className="flex items-center gap-2 text-xs font-medium text-forest"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Spray logged — PHI/REI windows stamped; the planner will respect them.
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={!anyCertified || pending}
        className="inline-flex items-center gap-2"
      >
        <SprayCan className="h-4 w-4" aria-hidden />{" "}
        {pending ? "Logging…" : "Log spray"}
      </Button>
    </form>
  );
}
