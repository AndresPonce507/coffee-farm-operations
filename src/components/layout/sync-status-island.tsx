"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  CloudOff,
  RotateCw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { useSyncStatus } from "@/lib/offline/useSyncStatus";
import type { OutboxEntry } from "@/lib/offline/outbox";
import { SyncStatusPill } from "./sync-status";

/** Elements that can hold keyboard focus inside the drawer, in DOM order. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * SyncStatus — the stateful island wired into the shell (P2-S0). It owns the
 * always-visible sync pill and a glass slide-over "outbox drawer" listing
 * queued + failed mutations with retry/dismiss. World-class means the offline
 * state is legible and reassuring, not a spinner: each entry shows what it is,
 * when it happened, and (for a dead-letter) exactly why it failed and what to do.
 *
 * The pill is the only animated shell element (opacity/transform only, GPU,
 * reduced-motion safe via `motion-safe:`). The drawer is a focus-trapped,
 * Escape-closable dialog portalled to <body>.
 */
export function SyncStatus() {
  const { state, deadLetters, pending, retry, dismiss } = useSyncStatus();
  const [open, setOpen] = useState(false);

  return (
    <>
      <SyncStatusPill state={state} onClick={() => setOpen(true)} />
      {open && (
        <OutboxDrawer
          deadLetters={deadLetters}
          pending={pending}
          online={state.online}
          onRetry={retry}
          onDismiss={dismiss}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function OutboxDrawer({
  deadLetters,
  pending,
  online,
  onRetry,
  onDismiss,
  onClose,
}: {
  deadLetters: OutboxEntry[];
  pending: OutboxEntry[];
  online: boolean;
  onRetry: (uuid: string) => void;
  onDismiss: (uuid: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  // The element focused right before the drawer opened, restored on close.
  const restoreRef = useRef<HTMLElement | null>(null);

  // Escape-to-close + body scroll-lock. The Escape listener is document-level
  // (NOT an in-subtree React onKeyDown): the trigger pill lives OUTSIDE this
  // portal, so a subtree handler would never receive the key until the user had
  // already clicked into the drawer. Body overflow is restored to its prior
  // value on cleanup (mirrors mobile-nav.tsx / the shared Dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Focus management — on open, remember the previously-focused element (the
  // pill) and move focus to the first focusable inside the panel (or the panel
  // itself). On close/unmount, restore focus there so keyboard users land back
  // on the pill instead of orphaned on <body>.
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
  }, []);

  if (typeof document === "undefined") return null;

  const empty = pending.length === 0 && deadLetters.length === 0;

  // Keep Tab/Shift+Tab inside the drawer by wrapping at the edges, so Tab can't
  // walk out into the page behind the (aria-modal) drawer.
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
      aria-label="Sync activity"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-forest/40 backdrop-blur-sm motion-safe:animate-fade-in"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full max-w-sm flex-col border-l border-white/60 bg-white/85 shadow-[-24px_0_64px_-20px_rgba(0,41,29,0.45)] backdrop-blur-xl outline-none motion-safe:animate-slide-in-right"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">
              Sync activity
            </h2>
            <p className="text-xs text-muted-fg">
              {online
                ? "Connected — changes save automatically."
                : "Offline — changes are safe on this device."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sync activity"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {empty && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-forest-50 text-forest ring-1 ring-forest-100">
                <CheckCircle2 className="h-6 w-6" aria-hidden />
              </span>
              <p className="text-sm font-medium text-ink">All caught up</p>
              <p className="max-w-[15rem] text-xs text-muted-fg">
                Every change is saved to the server. New field captures will
                queue here if you lose signal.
              </p>
            </div>
          )}

          {deadLetters.length > 0 && (
            <section aria-labelledby="dl-h">
              <h3
                id="dl-h"
                className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-cherry"
              >
                Needs attention · {deadLetters.length}
              </h3>
              <ul className="space-y-2">
                {deadLetters.map((e) => (
                  <li
                    key={e.uuid}
                    className="rounded-xl border border-cherry-100 bg-cherry-100/40 p-3"
                  >
                    <p className="text-sm font-medium text-ink">{e.rpc}</p>
                    <p className="mt-0.5 text-xs text-cherry">{e.lastError}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-muted-fg">
                        {timeAgo(e.enqueuedAt)}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => onRetry(e.uuid)}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-white/70 px-2 py-1 text-[11px] font-medium text-ink transition hover:bg-white"
                        >
                          <RotateCw className="h-3 w-3" aria-hidden /> Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismiss(e.uuid)}
                          aria-label={`Dismiss failed ${e.rpc}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-white/70 px-2 py-1 text-[11px] font-medium text-muted-fg transition hover:text-cherry"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden /> Dismiss
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pending.length > 0 && (
            <section aria-labelledby="pq-h">
              <h3
                id="pq-h"
                className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-honey-700"
              >
                <UploadCloud className="h-3.5 w-3.5" aria-hidden /> Waiting to
                sync · {pending.length}
              </h3>
              <ul className="space-y-2">
                {pending.map((e) => (
                  <li
                    key={e.uuid}
                    className="flex items-center justify-between rounded-xl border border-line bg-white/60 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">{e.rpc}</p>
                      <p className="text-[11px] text-muted-fg">
                        {timeAgo(e.enqueuedAt)}
                      </p>
                    </div>
                    {!online && (
                      <CloudOff
                        className="h-4 w-4 text-muted-fg"
                        aria-label="offline"
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
