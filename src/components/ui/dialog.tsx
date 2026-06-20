"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Lightweight glass modal. Owns Escape-to-close, scroll lock, and a click-away
 * backdrop. Rendered only when `open` so it stays out of the tree otherwise.
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-forest/40 backdrop-blur-sm"
      />
      <div className="animate-rise relative z-10 w-full max-w-md rounded-2xl border border-white/60 bg-white/85 p-6 shadow-[0_24px_64px_-20px_rgba(0,41,29,0.45)] backdrop-blur-xl">
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
