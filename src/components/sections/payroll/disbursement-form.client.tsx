"use client";

import {
  useActionState,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Banknote,
  Check,
  CheckCircle2,
  Eraser,
  HandCoins,
  PenLine,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EntityLink } from "@/components/ui/entity-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DISBURSEMENT_METHODS } from "@/lib/db/commands/recordDisbursement";
import type { Disbursement, WorkerPay } from "@/lib/db/payroll";
import { PAYROLL_IDLE, type PayrollActionState } from "@/app/(app)/payroll/state";
import { cn } from "@/lib/utils";

/**
 * The P2-S7 payroll WRITE islands — the human doors onto the already-tested Server
 * Actions (compute_pay_period / approve_pay_line / record_disbursement). The cockpit
 * was shipped READ-ONLY: the actions were live but unwired, so the dogfood moment
 * "at period end the family runs payroll" was unreachable. These islands close that
 * gap (review D10–D13), mirroring the established crew/ferment/qc form idiom.
 *
 * ⚠️ Each island depends on its action ONLY BY SHAPE — `(fd: FormData) =>
 * Promise<PayrollActionState>` passed in as a prop — so it never hard-imports the
 * route's `"use server"` file and stays trivially render-testable. The route wires
 * the real actions in. The make-whole guard, statutory math, append-only ledgers,
 * the cash-signed-needs-signature CHECK, and the disbursement→COGS write all live
 * un-bypassably in the database; these islands only marshal the form + surface the
 * friendly PayrollActionState. Money-shaped disbursement is NEVER automatic — it
 * fires only from the explicit, human-confirmed form below.
 */

/**
 * The by-shape action contract every island accepts (never the route import).
 * The payroll Server Actions are single-arg `(formData) => Promise<state>`; the
 * islands adapt them to the 2-arg `useActionState` reducer shape via `asReducer`.
 */
export type PayrollFormAction = (fd: FormData) => Promise<PayrollActionState>;

/** Adapt a single-arg payroll action to the `useActionState` reducer signature. */
function asReducer(action: PayrollFormAction) {
  return (_prev: PayrollActionState, fd: FormData) => action(fd);
}

const FIELD =
  "h-11 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100 disabled:opacity-50 aria-[invalid=true]:border-cherry aria-[invalid=true]:ring-cherry-100";
const LABEL = "text-xs font-medium text-muted-fg";

/** USD with cents — the islands' self-contained money formatter. */
function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** A human label for each disbursement rail (es-PA first, no jargon). */
const METHOD_LABEL: Record<(typeof DISBURSEMENT_METHODS)[number], string> = {
  yappy: "Yappy",
  nequi: "Nequi",
  ach: "ACH (transferencia bancaria)",
  "cash-signed": "Efectivo firmado · cash-signed",
};

/* ====================================================================== */
/* ComputePeriodForm — calculate (freeze) a pay period                    */
/* ====================================================================== */

/**
 * ComputePeriodForm — opens + freezes a pay period via `compute_pay_period`. The
 * family enters the window (and an optional season) and calculates: the RPC
 * find-or-creates the period then freezes a make-whole-guarded calculated pay_line
 * per active worker. Idempotent (re-calculating an already-frozen period is a no-op).
 */
export function ComputePeriodForm({
  action,
  defaultSeason,
  onDone,
}: {
  action: PayrollFormAction;
  /** Pre-fill the season label, e.g. "2026-2027". */
  defaultSeason?: string;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    asReducer(action),
    PAYROLL_IDLE,
  );

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 py-4 text-center"
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-forest-50 text-forest ring-1 ring-forest-100">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-sm text-muted-fg">{state.message}</p>
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" data-testid="compute-period-form">
      <div className="space-y-1">
        <label className={LABEL} htmlFor="compute-period-id">
          Identificador del período
        </label>
        <input
          id="compute-period-id"
          name="periodId"
          placeholder="p. ej. pp-2026-06-w3"
          required
          disabled={pending}
          className={FIELD}
          aria-invalid={fieldError("periodId") ? true : undefined}
        />
        {fieldError("periodId") && (
          <p className="text-xs text-cherry">{fieldError("periodId")}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="compute-period-start">
            Desde
          </label>
          <input
            id="compute-period-start"
            name="periodStart"
            type="date"
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("periodStart") ? true : undefined}
          />
          {fieldError("periodStart") && (
            <p className="text-xs text-cherry">{fieldError("periodStart")}</p>
          )}
        </div>
        <div className="space-y-1">
          <label className={LABEL} htmlFor="compute-period-end">
            Hasta
          </label>
          <input
            id="compute-period-end"
            name="periodEnd"
            type="date"
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("periodEnd") ? true : undefined}
          />
          {fieldError("periodEnd") && (
            <p className="text-xs text-cherry">{fieldError("periodEnd")}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="compute-period-season">
          Temporada <span className="text-muted-fg/60">(opcional)</span>
        </label>
        <input
          id="compute-period-season"
          name="season"
          defaultValue={defaultSeason}
          placeholder="2026-2027"
          disabled={pending}
          className={FIELD}
        />
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          <Wallet className="h-4 w-4" aria-hidden />
          {pending ? "Calculando…" : "Calculate period"}
        </Button>
      </div>
    </form>
  );
}

/* ====================================================================== */
/* ApprovePayLineButton — the review gate before disbursing               */
/* ====================================================================== */

/**
 * ApprovePayLineButton — flips one calculated pay line to `approved`, the review
 * gate the disbursement door checks. One tap fires `approve_pay_line` (idempotent);
 * on success it settles into a calm "Approved" confirmation rather than snapping back.
 */
export function ApprovePayLineButton({
  payLineId,
  workerName,
  action,
}: {
  payLineId: number;
  workerName: string;
  action: PayrollFormAction;
}) {
  const [state, formAction, pending] = useActionState(
    asReducer(action),
    PAYROLL_IDLE,
  );
  const approved = state.status === "success";

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="payLineId" value={payLineId} />
      <Button
        type="submit"
        variant={approved ? "outline" : "primary"}
        size="sm"
        disabled={pending || approved}
        aria-live="polite"
        aria-label={`Approve the pay line for ${workerName}`}
        className={cn(approved && "text-forest")}
      >
        {approved ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        )}
        {pending ? "Approving…" : approved ? "Approved" : "Approve"}
      </Button>
    </form>
  );
}

/* ====================================================================== */
/* SignaturePad — the $0 signed-cash capture for the unbanked crew        */
/* ====================================================================== */

/**
 * SignaturePad — a dependency-free <canvas> the family captures the worker's
 * signature on for a signed-cash payment (the ~90% Ngäbe-Buglé, largely-unbanked
 * crew). Pointer strokes paint to the canvas; on each stroke we lift a data-URL up
 * via `onChange` to become `signatureRef`. Clearing resets both. $0 / offline — no
 * paid service, no upload. The DB CHECK (`method <> 'cash-signed' or signature_ref
 * is not null`) is the real, un-bypassable enforcement; this is just the capture.
 *
 * Null-safe: under jsdom `getContext` returns null, so every draw call no-ops and
 * the pad still mounts + render-tests cleanly.
 */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  function pointFrom(e: ReactPointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / (rect.width || 1);
    const scaleY = c.height / (rect.height || 1);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function start(e: ReactPointerEvent<HTMLCanvasElement>) {
    const g = ctx();
    drawing.current = true;
    if (!g) return;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = 2.5;
    g.strokeStyle = "#0f2a1d";
    const p = pointFrom(e);
    g.beginPath();
    g.moveTo(p.x, p.y);
    canvasRef.current?.setPointerCapture?.(e.pointerId);
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const g = ctx();
    if (!g) return;
    const p = pointFrom(e);
    g.lineTo(p.x, p.y);
    g.stroke();
    dirty.current = true;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  }

  function clear() {
    const g = ctx();
    const c = canvasRef.current;
    if (g && c) g.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-fg">
          <PenLine className="h-3.5 w-3.5" aria-hidden />
          Firma del trabajador · signature
        </span>
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-fg transition hover:bg-white/60 hover:text-ink"
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden />
          Borrar
        </button>
      </div>
      <canvas
        ref={canvasRef}
        data-testid="signature-pad"
        width={520}
        height={160}
        aria-label="Firma del trabajador para el pago en efectivo"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-40 w-full touch-none rounded-xl border border-line bg-white/80"
      />
      <p className="text-[11px] text-muted-fg">
        El trabajador firma aquí para confirmar que recibió el pago en efectivo.
      </p>
    </div>
  );
}

/* ====================================================================== */
/* DisbursementForm — THE irreversible, human-confirmed money action       */
/* ====================================================================== */

/**
 * DisbursementForm — records a payment a human has already moved (Yappy / Nequi /
 * ACH / signed-cash) for one approved worker+period via `record_disbursement`,
 * which also writes the matching Phase-1 COGS cost_entry (payroll IS labor cost,
 * no double-keying). Method selector over every rail; choosing "cash-signed"
 * reveals the $0 signature pad and gates submit until a signature is captured (the
 * DB CHECK is the real guard). Record-only — no payment API moves money here.
 */
export function DisbursementForm({
  payPeriodId,
  worker,
  action,
  onDone,
}: {
  payPeriodId: string;
  worker: WorkerPay;
  action: PayrollFormAction;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    asReducer(action),
    PAYROLL_IDLE,
  );
  const [method, setMethod] =
    useState<(typeof DISBURSEMENT_METHODS)[number]>("yappy");
  const [signature, setSignature] = useState<string | null>(null);

  const cashSigned = method === "cash-signed";
  // a cash-signed payment cannot be submitted until a signature is captured (the
  // DB CHECK enforces it un-bypassably; this just blocks the round-trip early).
  const blockedForSignature = cashSigned && !signature;

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 py-4 text-center"
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-forest-50 text-forest ring-1 ring-forest-100">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-sm text-muted-fg">{state.message}</p>
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-4"
      data-testid="disbursement-form"
    >
      <input type="hidden" name="payPeriodId" value={payPeriodId} />
      <input type="hidden" name="workerId" value={worker.workerId} />
      {/* the captured signature data-URL rides up as the signatureRef field. */}
      <input type="hidden" name="signatureRef" value={signature ?? ""} />

      <div className="flex items-baseline justify-between gap-3 rounded-xl bg-forest-50/60 px-3 py-2">
        <span className="text-sm font-medium text-ink">{worker.workerName}</span>
        <span className="text-xs text-muted-fg">
          neto <span className="font-semibold tabular-nums text-forest-700">{usd(worker.netUsd)}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="disb-method">
            Método de pago
          </label>
          <select
            id="disb-method"
            name="method"
            value={method}
            onChange={(e) =>
              setMethod(e.target.value as (typeof DISBURSEMENT_METHODS)[number])
            }
            disabled={pending}
            className={FIELD}
          >
            {DISBURSEMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="disb-amount">
            Monto (USD)
          </label>
          <input
            id="disb-amount"
            name="amountUsd"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            defaultValue={worker.netUsd.toFixed(2)}
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("amountUsd") ? true : undefined}
          />
          {fieldError("amountUsd") && (
            <p className="text-xs text-cherry">{fieldError("amountUsd")}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="disb-ref">
          Referencia / recibo{" "}
          <span className="text-muted-fg/60">(opcional)</span>
        </label>
        <input
          id="disb-ref"
          name="ref"
          placeholder="p. ej. yappy-tx-1024"
          disabled={pending}
          className={FIELD}
        />
      </div>

      {cashSigned && (
        <div className="rounded-xl border border-honey-100 bg-honey-100/40 p-3">
          <SignaturePad onChange={setSignature} />
          {fieldError("signatureRef") && (
            <p className="mt-1 text-xs text-cherry">
              {fieldError("signatureRef")}
            </p>
          )}
          {blockedForSignature && (
            <p className="mt-1 text-xs text-honey-700">
              Capture la firma del trabajador para registrar el pago en efectivo.
            </p>
          )}
        </div>
      )}

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex items-center gap-2 rounded-xl border border-line bg-white/50 px-3 py-2 text-[11px] text-muted-fg">
        <HandCoins className="h-4 w-4 shrink-0 text-coffee" aria-hidden />
        <span>
          Acción deliberada e irreversible — registra un pago ya realizado. No
          mueve dinero por sí sola.
        </span>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={pending || blockedForSignature}>
          <Banknote className="h-4 w-4" aria-hidden />
          {pending ? "Registrando…" : "Record disbursement"}
        </Button>
      </div>
    </form>
  );
}

/* ====================================================================== */
/* DisbursementLedger — read of the append-only payment trail              */
/* ====================================================================== */

/**
 * DisbursementLedger — the period's recorded payments, newest first, so the family
 * can reconcile who's been paid vs still owed. Shows each row's worker, method,
 * amount, and (for signed-cash) a "firmado" marker that the dignity signature trail
 * is captured. Renders nothing when the period has no recorded payments yet.
 */
export function DisbursementLedger({
  disbursements,
  workerNames,
}: {
  disbursements: Disbursement[];
  /** workerId → display name, resolved upstream from the pay rows. */
  workerNames: Record<string, string>;
}) {
  if (disbursements.length === 0) return null;

  return (
    <Card data-testid="disbursement-ledger" className="animate-rise">
      <CardHeader>
        <div>
          <CardTitle>Pagos registrados</CardTitle>
          <CardDescription>
            Libro de pagos del período — el más reciente primero
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="stagger space-y-2">
          {disbursements.map((d) => {
            const signed = d.method === "cash-signed";
            return (
              <li
                key={d.id}
                data-testid={`disbursement-row-${d.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/60 bg-white/55 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    <EntityLink kind="worker" id={d.workerId}>
                      {workerNames[d.workerId] ?? d.workerId}
                    </EntityLink>
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-fg">
                    <span>{METHOD_LABEL[d.method as keyof typeof METHOD_LABEL] ?? d.method}</span>
                    {signed && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-honey-100 px-1.5 py-0.5 text-[10px] font-medium text-honey-700">
                        <PenLine className="h-3 w-3" aria-hidden />
                        firmado
                      </span>
                    )}
                    {d.ref ? (
                      <span className="truncate text-muted-fg/70">· {d.ref}</span>
                    ) : null}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-display text-sm font-semibold tabular-nums",
                    d.amountUsd < 0 ? "text-cherry" : "text-forest-700",
                  )}
                >
                  {usd(d.amountUsd)}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
