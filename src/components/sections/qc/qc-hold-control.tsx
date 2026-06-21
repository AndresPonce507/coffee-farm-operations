"use client";

import { useActionState, useEffect, useState } from "react";
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
 * safe. The oversell/hold guard lives in the database; this is the human door.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";

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
  return (
    <form action={formAction} className="inline">
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

  useEffect(() => {
    if (state.status === "success") {
      const t = setTimeout(onClose, 700);
      return () => clearTimeout(t);
    }
  }, [state, onClose]);

  if (!mounted) return null;

  const reasonError = state.status === "error" ? state.errors?.reason : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Place QC-hold on ${lotCode}`}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-forest/40 backdrop-blur-sm"
      />

      <div className="animate-rise relative z-10 flex h-full w-full max-w-sm flex-col border-l border-white/60 bg-white/85 p-6 shadow-[0_24px_64px_-20px_rgba(0,41,29,0.45)] backdrop-blur-xl">
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
              role="status"
              className={cn(
                "flex items-center gap-2 rounded-xl border border-cherry-100 bg-cherry-100/95 px-4 py-3",
                "text-sm font-medium text-cherry shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)] backdrop-blur-md",
              )}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {state.message ?? "QC-hold placed."}
            </div>
          )}
          {state.status === "error" && state.message && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-cherry-100 bg-cherry-100/95 px-4 py-3 text-sm font-medium text-cherry shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)] backdrop-blur-md"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{state.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
