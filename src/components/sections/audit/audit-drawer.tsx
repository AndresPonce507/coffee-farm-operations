"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, ShieldAlert, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LotEvent } from "@/lib/types";

import {
  eventKindChip,
  eventKindIcon,
  humanizeKind,
} from "./event-kind-style";

export interface AuditDrawerProps {
  /** Whether the slide-over is shown. Rendered out of the tree when false. */
  open: boolean;
  /** Close handler — wired to Escape, the backdrop, and the close button. */
  onClose: () => void;
  /** The stream this chain belongs to (one stream per lot, e.g. "JC-564"). */
  streamKey: string;
  /** The append-only event chain for this stream, oldest → newest. */
  events: LotEvent[];
  /** verify_chain(stream) result — drives the green/amber badge. */
  chainVerified: boolean;
}

/** Render a timestamptz/ISO string as a compact, locale-stable wall-clock. */
function formatClock(value: string): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  return new Date(t).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * AuditDrawer — the S3 dogfood proof.
 *
 * A glass slide-over showing one stream's append-only, hash-chained event
 * ledger (ADR-001), topped by a green "Chain verified" / amber "Chain
 * unverified" badge sourced from `verify_chain`. Because the activity feed is a
 * projection of this same ledger, the rows here cannot disagree with the feed.
 *
 * Glass discipline (CLAUDE.md): real `backdrop-blur` lives ONLY on the floating
 * panel; the slide-in is a GPU `translateX` + opacity transform (no layout, no
 * paint); `prefers-reduced-motion` is honoured globally in `globals.css`; every
 * event chip is an OPAQUE inner surface so its label keeps WCAG-AA contrast and
 * never samples the translucent panel behind it.
 */
export function AuditDrawer({
  open,
  onClose,
  streamKey,
  events,
  chainVerified,
}: AuditDrawerProps) {
  // Portal target only exists on the client. Gate the portal on mount so SSR
  // renders nothing (the drawer is always opened by a client interaction anyway).
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

  if (!open || !mounted) return null;

  const VerifyIcon = chainVerified ? ShieldCheck : ShieldAlert;

  // Portal to <body> so the slide-over escapes every page stacking context. The
  // page shell + cards carry lingering `transform`s (from `animate-rise`, whose
  // end state is translateY(0) — still a transform, so still a stacking context),
  // which would otherwise trap this z-50 layer *below* sibling cards and let page
  // content render through the drawer. (Fixes the "drawer renders behind the page" bug.)
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Audit trail for ${streamKey}`}
    >
      {/* Click-away backdrop — soft forest scrim, mild blur on the chrome only. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-forest/40 backdrop-blur-sm"
      />

      {/* The floating panel — the ONE surface that carries real backdrop-blur.
          Enters via the shared GPU transform+opacity entrance (animate-rise),
          which globals.css already neutralises under prefers-reduced-motion. */}
      <aside
        className={cn(
          "animate-rise relative z-10 flex h-full w-full max-w-md flex-col",
          "border-l border-white/60 bg-white/85 backdrop-blur-xl",
          "shadow-[0_24px_64px_-20px_rgba(0,41,29,0.45)]",
        )}
      >
        {/* Header — stream identity + the chain-verified verdict. */}
        <header className="flex items-start justify-between gap-3 border-b border-line/70 px-5 pt-5 pb-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
              Audit trail
            </p>
            <h2 className="font-display text-lg font-semibold text-ink">
              {streamKey}
            </h2>
            <div className="mt-2" data-testid="chain-badge">
              <Badge tone={chainVerified ? "forest" : "honey"} className="gap-1.5">
                <VerifyIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {chainVerified ? "Chain verified" : "Chain unverified"}
              </Badge>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close audit trail"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* The chain — one row per event, oldest → newest, vertical timeline. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {events.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-fg">
              No events recorded for this stream yet.
            </p>
          ) : (
            <ol className="stagger relative space-y-3">
              {events.map((evt) => {
                const Icon = eventKindIcon(evt.kind);
                return (
                  <li
                    key={evt.id}
                    className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors duration-200 hover:bg-white/55"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        eventKindChip(evt.kind),
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium text-ink">
                          {humanizeKind(evt.kind)}
                        </p>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-fg">
                          #{evt.deviceSeq}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-fg">
                        {formatClock(evt.occurredAt)} · {evt.deviceId}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
