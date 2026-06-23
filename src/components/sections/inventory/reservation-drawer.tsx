"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Lock, X } from "lucide-react";

import type { GreenLotAtp } from "@/lib/types";
import {
  INVENTORY_IDLE,
  reserveGreenLotAction,
  type InventoryActionState,
} from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { cn, kg } from "@/lib/utils";

/**
 * ReservationDrawer — the ONE client island on /inventory (S5).
 *
 * Everything else on the route is a Server Component; this thin island owns the
 * only interactive money-shaped surface: holding kg of a green lot against a
 * buyer. It is a right-anchored glass drawer (slides in on transform/opacity, GPU
 * only) carrying the reserve form, driven by the `reserveGreenLotAction` Server
 * Action through `useActionState`.
 *
 * The oversell guard lives in the database (the `prevent_oversell` BEFORE INSERT
 * trigger, fail-closed) — the UI *cannot* create a double-sell. Two belts on top
 * of that braces:
 *   1. A lot with zero ATP renders its trigger DISABLED ("Sold out") — the UI
 *      will not even attempt a reservation it knows the DB would reject.
 *   2. If the trigger DOES fire (a racing concurrent reservation eats the last
 *      kg between render and submit), the action returns a clean message which we
 *      surface as an on-brand glass TOAST — never a raw Postgres exception.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

/** Elements that can hold keyboard focus inside the drawer, in DOM order. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ReservationDrawer({ lot }: { lot: GreenLotAtp }) {
  const [open, setOpen] = useState(false);
  const soldOut = lot.atp <= 0;

  return (
    <>
      <Button
        type="button"
        variant={soldOut ? "ghost" : "outline"}
        size="sm"
        disabled={soldOut}
        onClick={() => setOpen(true)}
        aria-label={
          soldOut
            ? `${lot.greenLotCode} sold out`
            : `Reserve ${lot.greenLotCode}`
        }
      >
        {soldOut ? (
          <>
            <Lock className="h-3.5 w-3.5" />
            Sold out
          </>
        ) : (
          "Reserve"
        )}
      </Button>

      {open && <ReservationPanel lot={lot} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReservationPanel({
  lot,
  onClose,
}: {
  lot: GreenLotAtp;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    InventoryActionState,
    FormData
  >(reserveGreenLotAction, INVENTORY_IDLE);

  const panelRef = useRef<HTMLDivElement>(null);
  // The element focused right before the drawer opened, restored on close.
  const restoreRef = useRef<HTMLElement | null>(null);
  // Portal target only exists on the client. Gate the portal on mount so SSR
  // renders nothing (this drawer is only ever opened by a client interaction).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape-to-close + scroll lock while the drawer is mounted.
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

  // Focus management (WCAG 2.4.3 / 2.1.2) — mirrors the shared <Dialog> primitive.
  // On open: remember the previously-focused element, then move focus to the
  // first focusable inside the panel (or the panel itself). On close/unmount:
  // restore focus to that remembered element so keyboard users land back on the
  // Reserve trigger instead of resetting to <body>. `mounted` is a dep because the
  // panel only exists once the portal has mounted on the client.
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

  // A successful hold closes the drawer (the page revalidates server-side).
  useEffect(() => {
    if (state.status === "success") {
      const t = setTimeout(onClose, 700);
      return () => clearTimeout(t);
    }
  }, [state, onClose]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  // The oversell / failure message is rendered as a glass toast (alert).
  const toastMessage =
    state.status === "error" && state.message ? state.message : null;

  if (!mounted) return null;

  // Keep Tab/Shift+Tab inside the drawer by wrapping at the edges (focus trap).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (focusables.length === 0) {
      // Nothing focusable but the panel — keep focus pinned to it.
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

  // Portal to <body> so the drawer escapes every page stacking context. The page
  // shell + cards carry lingering `transform`s (from `animate-rise`, whose end
  // state translateY(0) is still a transform → still a stacking context), which
  // would otherwise trap this z-50 layer *below* sibling cards and let page
  // content render through the drawer. (Fixes the "renders behind the page" bug.)
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Reserve green lot ${lot.greenLotCode}`}
      onKeyDown={onKeyDown}
    >
      {/* Click-away scrim. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-forest/40 backdrop-blur-sm"
      />

      {/* The drawer panel — slides in from the right (GPU transform). */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="animate-rise relative z-10 flex h-full w-full max-w-sm flex-col border-l border-white/60 bg-white/85 p-6 shadow-[0_24px_64px_-20px_rgba(0,41,29,0.45)] backdrop-blur-xl outline-none"
      >
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Reserve green lot
            </h2>
            <p className="mt-0.5 font-mono text-sm text-forest-700">
              {lot.greenLotCode}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Available-to-promise context so the family reserves against a known
            ceiling. The DB is the real ceiling; this is the human-readable one. */}
        <div className="mt-4 rounded-xl border border-white/60 bg-white/55 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
            Available to promise
          </p>
          <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-honey-700">
            {kg(lot.atp)}
          </p>
          <p className="mt-0.5 text-xs text-muted-fg">
            {kg(lot.currentKg)} on hand · {kg(lot.reservedKg + lot.shippedKg)}{" "}
            committed · {lot.location}
          </p>
        </div>

        <form action={formAction} className="mt-5 flex flex-1 flex-col gap-3">
          <input type="hidden" name="greenLotCode" value={lot.greenLotCode} />

          <div className="space-y-1">
            <label className={LABEL} htmlFor="reserve-buyer">
              Buyer
            </label>
            <input
              id="reserve-buyer"
              name="buyer"
              placeholder="e.g. Onyx Coffee Lab"
              className={FIELD}
            />
            {fieldError("buyer") && (
              <p className="text-xs text-cherry">{fieldError("buyer")}</p>
            )}
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="reserve-kg">
              Kilograms to reserve
            </label>
            <input
              id="reserve-kg"
              name="kg"
              type="number"
              min="0"
              max={lot.atp}
              step="any"
              placeholder={`up to ${lot.atp}`}
              className={FIELD}
            />
            {fieldError("kg") && (
              <p className="text-xs text-cherry">{fieldError("kg")}</p>
            )}
          </div>

          <div className="mt-auto flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Holding…" : "Hold reservation"}
            </Button>
          </div>
        </form>

        {/* Glass toast region — success or the clean oversell rejection. Lives in
            the drawer (its own feedback surface). aria-live announces it. */}
        <div
          data-testid="reservation-toast-region"
          aria-live="assertive"
          className="pointer-events-none absolute inset-x-4 bottom-4"
        >
          {state.status === "success" && (
            <div
              role="status"
              className={cn(
                "flex items-center gap-2 rounded-xl border border-forest-300 bg-forest-100/95 px-4 py-3",
                "text-sm font-medium text-forest-700 shadow-[0_12px_32px_-12px_rgba(0,41,29,0.45)] backdrop-blur-md",
              )}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-forest" />
              {state.message ?? "Reservation held."}
            </div>
          )}

          {toastMessage && (
            <div
              role="alert"
              className={cn(
                "flex items-start gap-2 rounded-xl border border-cherry-100 bg-cherry-100/95 px-4 py-3",
                "text-sm font-medium text-cherry shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)] backdrop-blur-md",
              )}
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
