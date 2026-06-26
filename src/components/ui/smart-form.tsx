"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * smart-form — the bound-form contract (facet-03 §1.2).
 *
 * Factors the success-pane + error-surface + `useActionState` + idempotency-key
 * boilerplate that start-ferment-form.tsx, the payroll forms, and cherry-intake-form
 * each re-implement, so a Phase-5 form is ~30 lines of fields instead of re-deriving
 * the scaffold. Behaviour-identical to those three (same success pane, same
 * `role="alert"` error line, same idempotency idiom). Existing forms are NOT migrated
 * (flag-don't-fix); new slices build on `SmartForm`.
 */

/**
 * The canonical action state every smart-bar form's action returns. A **strict
 * SUPERSET** of the live `ActionState` (`src/lib/actions/plots.ts:9`) — it adds only an
 * optional `href?` to the success variant, so a write can deep-link to its result.
 * Therefore ANY existing route action passes straight into `SmartForm` with NO adapter
 * (ARCHITECTURE §7 C4; REVIEWER-1 verifies).
 */
export type SmartActionState =
  | { status: "idle" }
  | { status: "success"; message: string; href?: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

/** The idle seed for `useActionState`. */
export const SMART_IDLE: SmartActionState = { status: "idle" };

/**
 * The reducer shape `useActionState` drives — `(prev, FormData) => state`, matching the
 * repo's `(prev, FormData) => Promise<ActionState>` Server Action signature exactly, so
 * a route action passes straight in. Also accepts the synchronous by-shape prop idiom
 * (disbursement-form.client.tsx) for render-testability.
 */
export type SmartReducer = (
  prev: SmartActionState,
  fd: FormData,
) => Promise<SmartActionState> | SmartActionState;

export function SmartForm({
  action,
  idempotent = false,
  submitLabel,
  pendingLabel,
  onDone,
  children,
}: {
  action: SmartReducer;
  /** Mints a hidden `idempotencyKey` when true (write/genesis `lot_event` appends). */
  idempotent?: boolean;
  submitLabel: string;
  pendingLabel: string;
  onDone?: () => void;
  children: (h: {
    pending: boolean;
    fieldError: (k: string) => string | undefined;
  }) => ReactNode;
}) {
  const t = useTranslations("ui");
  const [state, formAction, pending] = useActionState(action, SMART_IDLE);
  // Stable per-mount key so a double-submit dedupes to one record on the write door.
  const [idemKey] = useState(() => crypto.randomUUID());
  const fieldError = (k: string) =>
    state.status === "error" ? state.errors?.[k] : undefined;

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
        {state.href && (
          <a
            href={state.href}
            className="text-sm font-medium text-forest underline"
          >
            {t("smartForm.view")}
          </a>
        )}
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {t("smartForm.done")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {idempotent && (
        <input type="hidden" name="idempotencyKey" value={idemKey} />
      )}
      {children({ pending, fieldError })}
      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("smartForm.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
