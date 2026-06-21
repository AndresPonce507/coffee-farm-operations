import {
  Check,
  CloudOff,
  RefreshCw,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";

import type { SyncState } from "@/lib/offline/sync";

/**
 * SyncStatusPill — the always-visible chrome that tells a picker in a dead zone
 * their weigh-in is safe (P2-S0). This is the PURE, presentational render of a
 * `SyncState` (the stateful island `<SyncStatus>` wraps it), so its five states
 * are render-testable in jsdom with no IndexedDB.
 *
 * World-class: a `polite` live region (screen readers hear status flips), a
 * distinct accessible name + colour per state, AA contrast on the glass chrome,
 * GPU-only animation (the syncing spinner + a soft pulse), and reduced-motion
 * safe (animations are class-gated and the app respects `prefers-reduced-motion`
 * globally). The pill is a button so the operator can open the outbox drawer.
 */

const COUNT_BADGE =
  "ml-0.5 grid min-w-[1.25rem] place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums";

interface Visual {
  Icon: typeof Check;
  /** Visible label. */
  label: string;
  /** The accessible name (richer than the visible label for SR users). */
  aria: (s: SyncState) => string;
  /** pill tint classes. */
  tone: string;
  /** count-badge tint. */
  badge: string;
  /** does this state show a count, and which? */
  count?: (s: SyncState) => number;
  spin?: boolean;
}

const VISUALS: Record<SyncState["status"], Visual> = {
  synced: {
    Icon: Check,
    label: "Up to date",
    aria: () => "Synced — everything is saved to the server",
    tone: "border-forest-100 bg-forest-50/70 text-forest-700",
    badge: "bg-forest-100 text-forest-700",
  },
  pending: {
    Icon: UploadCloud,
    label: "Queued",
    aria: (s) => `${s.pending} change${s.pending === 1 ? "" : "s"} queued, waiting to sync`,
    tone: "border-honey-100 bg-honey-100/60 text-honey-700",
    badge: "bg-honey-100 text-honey-700",
    count: (s) => s.pending,
  },
  syncing: {
    Icon: RefreshCw,
    label: "Syncing",
    aria: (s) => `Syncing ${s.pending} change${s.pending === 1 ? "" : "s"} to the server`,
    tone: "border-sky-100 bg-sky-100/60 text-sky",
    badge: "bg-sky-100 text-sky",
    count: (s) => s.pending,
    spin: true,
  },
  offline: {
    Icon: CloudOff,
    label: "Offline",
    aria: (s) =>
      `Offline — ${s.pending} change${s.pending === 1 ? "" : "s"} saved on this device, will sync when you reconnect`,
    tone: "border-line-strong bg-muted/80 text-coffee",
    badge: "bg-coffee-200 text-coffee",
    count: (s) => s.pending,
  },
  failed: {
    Icon: TriangleAlert,
    label: "Needs attention",
    aria: (s) =>
      `${s.dead} change${s.dead === 1 ? "" : "s"} failed and need attention`,
    tone: "border-cherry-100 bg-cherry-100/70 text-cherry",
    badge: "bg-cherry-100 text-cherry",
    count: (s) => s.dead,
  },
};

export function SyncStatusPill({
  state,
  onClick,
}: {
  state: SyncState;
  onClick?: () => void;
}) {
  const v = VISUALS[state.status];
  const count = v.count?.(state);

  return (
    <button
      type="button"
      data-testid="sync-pill"
      onClick={onClick}
      aria-live="polite"
      aria-label={v.aria(state)}
      title={v.aria(state)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100 motion-safe:hover:-translate-y-px ${v.tone}`}
    >
      <v.Icon
        className={`h-[15px] w-[15px] ${v.spin ? "motion-safe:animate-spin" : ""}`}
        aria-hidden
      />
      <span className="hidden sm:inline">{v.label}</span>
      {typeof count === "number" && count > 0 && (
        <span className={`${COUNT_BADGE} ${v.badge}`}>{count}</span>
      )}
    </button>
  );
}
