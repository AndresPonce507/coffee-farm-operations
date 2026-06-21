"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
  const panelRef = useRef<HTMLDivElement>(null);
  // The element focused right before the modal opened, restored on close.
  const restoreRef = useRef<HTMLElement | null>(null);

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
  }, [open]);

  if (!open) return null;

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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
        className="animate-rise relative z-10 w-full max-w-md rounded-2xl border border-white/60 bg-white/85 p-6 shadow-[0_24px_64px_-20px_rgba(0,41,29,0.45)] backdrop-blur-xl outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
