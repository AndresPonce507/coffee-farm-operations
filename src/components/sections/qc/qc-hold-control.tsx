"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Lock, LockOpen, ShieldAlert, X } from "lucide-react";

import type { QcStatus } from "@/lib/types";
import {
  placeQcHoldAction,
  releaseQcHoldAction,
  QC_IDLE,
  type QcActionState,
} from "@/app/(app)/qc/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * QcHoldControl — the client island that places/releases a QC-HOLD on a green lot
 * (P2-S6, the cup-protection teeth). Placing a hold makes the lot physically
 * un-sellable (the `_prevent_held_lot_commit` DB trigger is the real fail-closed
 * guard); releasing re-opens commerce. A held lot shows a "Release" affordance; a
 * clear lot shows a "Hold" affordance that opens a reason drawer.
 *
 * GPU-only transform/opacity drawer, escape-to-close, portal to <body> (so it
 * escapes every card stacking context — the Phase-1 drawer fix), reduced-motion
 * safe. Because it declares `aria-modal="true"` it also owns full modal focus
 * management — initial focus into the drawer, a Tab/Shift+Tab trap, and focus
 * restore to the trigger on close — mirroring the shared Dialog (dialog.tsx) so
 * the inertness promise is honored for keyboard/screen-reader users (#86). The
 * oversell/hold guard lives in the database; this is the human door.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";

/** Elements that can hold keyboard focus inside the drawer, in DOM order
 *  (matches the shared Dialog so the trap behaves identically). */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Map a raw Postgres/PostgREST error message onto clean, family-readable copy so
 * a non-technical crew/family audience never sees a constraint name or a labelled
 * `place_qc_hold:` / `release_qc_hold:` passthrough (#123). The QC commands surface
 * the raw text as `state.message`; this is the render-boundary sanitizer that
 * mirrors the house `friendlyRpcError` seam (recordFermentReading.ts) for the one
 * surface that renders it. A non-error state has no message, so this is only ever
 * called for `state.status === "error"`.
 */
function friendlyQcHoldMessage(raw: string | undefined): string {
  const fallback = "Couldn't complete that — please try again.";
  if (!raw) return fallback;
  if (/duplicate key value|unique constraint|already exists/i.test(raw)) {
    return "That hold was already recorded — refresh and try again.";
  }
  if (/foreign key|violates foreign key|unknown green lot/i.test(raw)) {
    return "That green lot doesn't exist.";
  }
  if (/restrict_violation|append-only|is locked|cannot be (changed|deleted)/i.test(raw)) {
    return "This QC record is locked and can't be changed.";
  }
  return fallback;
}

export function QcHoldControl({ lot }: { lot: QcStatus }) {
  const [open, setOpen] = useState(false);

  if (lot.held) {
    return <ReleaseButton lotCode={lot.greenLotCode} />;
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Place QC-hold on ${lot.greenLotCode}`}
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        Hold
      </Button>
      {open && <HoldPanel lotCode={lot.greenLotCode} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReleaseButton({ lotCode }: { lotCode: string }) {
  const [state, formAction, pending] = useActionState<QcActionState, FormData>(
    releaseQcHoldAction,
    QC_IDLE,
  );
  // A failed release must not flip silently back to "Release" with zero feedback —
  // surface a friendly inline alert so the operator knows the lot is still held
  // and can retry (#85). The button only disables on pending/success, so an error
  // state already leaves it clickable for the retry.
  const releaseError =
    state.status === "error"
      ? (state.errors?.greenLotCode ?? friendlyQcHoldMessage(state.message))
      : undefined;
  return (
    <form action={formAction} className="inline-flex flex-col items-end">
      <input type="hidden" name="greenLotCode" value={lotCode} />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        disabled={pending || state.status === "success"}
        aria-label={`Release QC-hold on ${lotCode}`}
      >
        <LockOpen className="h-3.5 w-3.5" />
        {pending ? "Releasing…" : state.status === "success" ? "Released" : "Release"}
      </Button>
      {releaseError && (
        <p role="alert" className="mt-1 max-w-[12rem] text-right text-xs text-cherry">
          {releaseError}
        </p>
      )}
    </form>
  );
}

function HoldPanel({
  lotCode,
  onClose,
}: {
  lotCode: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<QcActionState, FormData>(
    placeQcHoldAction,
    QC_IDLE,
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panelRef = useRef<HTMLDivElement>(null);
  // The element focused right before the drawer opened, restored on close.
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Focus management (#86) — additive, no motion. On open: remember the
  // previously-focused element (the Hold trigger), then move focus to the first
  // focusable inside the drawer (or the panel itself). On close/unmount: restore
  // focus to that element so keyboard users land back on the trigger. `mounted`
  // is a dep because the panel only exists after the portal mounts.
  useEffect(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    }

    return () => {
      restoreRef.current?.focus?.();
    };
  }, [mounted]);

  useEffect(() => {
    if (state.status === "success") {
      const t = setTimeout(onClose, 700);
      return () => clearTimeout(t);
    }
  }, [state, onClose]);

  if (!mounted) return null;

  const reasonError = state.status === "error" ? state.errors?.reason : undefined;
  const submitError =
    state.status === "error" && !reasonError
      ? friendlyQcHoldMessage(state.message)
      : undefined;

  // Keep Tab/Shift+Tab inside the drawer by wrapping at the edges (mirrors the
  // shared Dialog so AT's aria-modal inertness promise is honored).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (focusables.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey) {
      if (activeEl === first || !panel.contains(activeEl)) {
        e.preventDefault();
        last.focus();
      }
    } else if (activeEl === last || !panel.contains(activeEl)) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Place QC-hold on ${lotCode}`}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-forest/40 backdrop-blur-sm"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="animate-rise relative z-10 flex h-full w-full max-w-sm flex-col border-l border-white/60 bg-white/85 p-6 shadow-[0_24px_64px_-20px_rgba(0,41,29,0.45)] backdrop-blur-xl outline-none"
      >
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Place QC-hold
            </h2>
            <p className="mt-0.5 font-mono text-sm text-cherry">{lotCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-cherry-100 bg-cherry-100/55 px-4 py-3 text-xs text-cherry">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            A held lot cannot be reserved or shipped until released — enforced in the
            database, not just here.
          </span>
        </div>

        <form action={formAction} className="mt-5 flex flex-1 flex-col gap-3">
          <input type="hidden" name="greenLotCode" value={lotCode} />
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-fg" htmlFor="hold-reason">
              Reason
            </label>
            <input
              id="hold-reason"
              name="reason"
              placeholder="e.g. off-flavor — re-cup before sale"
              className={FIELD}
            />
            {reasonError && <p className="text-xs text-cherry">{reasonError}</p>}
          </div>

          <div className="mt-auto flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Holding…" : "Place hold"}
            </Button>
          </div>
        </form>

        <div
          aria-live="assertive"
          className="pointer-events-none absolute inset-x-4 bottom-4"
        >
          {state.status === "success" && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl border border-cherry-100 bg-cherry-100/95 px-4 py-3",
                "text-sm font-medium text-cherry shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)] backdrop-blur-md",
              )}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {state.message ?? "QC-hold placed."}
            </div>
          )}
          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-cherry-100 bg-cherry-100/95 px-4 py-3 text-sm font-medium text-cherry shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)] backdrop-blur-md"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
