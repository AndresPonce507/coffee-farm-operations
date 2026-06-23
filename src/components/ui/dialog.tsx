"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

/** Elements that can hold keyboard focus inside the modal, in DOM order. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Lightweight glass modal. Owns Escape-to-close, scroll lock, a click-away
 * backdrop, and full modal focus management (initial focus, focus trap, focus
 * restore). Rendered only when `open` so it stays out of the tree otherwise.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const t = useTranslations("ui");
  const panelRef = useRef<HTMLDivElement>(null);
  // The element focused right before the modal opened, restored on close.
  const restoreRef = useRef<HTMLElement | null>(null);
  // Portal target only exists on the client. Gate the portal on mount so SSR
  // renders nothing (the modal is always opened by a client interaction anyway).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Focus management — additive, no motion (the only animation is the existing
  // CSS `animate-rise`, already neutralized by the global reduced-motion rule).
  // On open: remember the previously-focused element, then move focus to the
  // first focusable inside the modal (or the panel itself). On close/unmount:
  // restore focus to that remembered element so keyboard users land back where
  // they were.
  useEffect(() => {
    if (!open) return;
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
    // `mounted` is a dep: the panel only exists after the portal mounts, so the
    // focus-into-dialog must (re-)run once mounting makes panelRef.current real.
  }, [open, mounted]);

  if (!open || !mounted) return null;

  // Keep Tab/Shift+Tab inside the modal by wrapping at the edges.
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

  // Portal to <body> so the modal escapes every page stacking context. The page
  // shell + cards carry lingering `transform`s (from `animate-rise`, whose end
  // state is translateY(0) — still a transform, so still a stacking context),
  // which would otherwise trap this z-50 layer *below* sibling cards and let page
  // content render through the modal. (Fixes the "form renders behind the page" bug.)
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label={t("dialog.close")}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-forest/40 backdrop-blur-sm"
      />
      {/* Panel is height-capped (`max-h-[85svh]`) and laid out as a column so a
          non-shrinking header stays pinned while an overflowing body scrolls.
          Without this, an unbounded ledger (e.g. a multi-season attendance
          timeline rendered via the crew rehire strip) grows past the viewport
          and — since the overlay is `fixed inset-0 grid place-items-center` with
          body scroll locked — overflows off BOTH edges, pushing the title + X
          off-screen and trapping touch users. Mirrors the audit-drawer idiom
          (header + `min-h-0 flex-1 overflow-y-auto` body). */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="animate-rise relative z-10 flex max-h-[85svh] w-full max-w-md flex-col rounded-2xl border border-white/60 bg-white/85 shadow-[0_24px_64px_-20px_rgba(0,41,29,0.45)] backdrop-blur-xl outline-none"
      >
        {/* Pinned header — title + close stay reachable while the body scrolls. */}
        <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("dialog.closeDialog")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Scrollable body — overflowing content stays reachable instead of
            spilling off the top/bottom of the viewport. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
