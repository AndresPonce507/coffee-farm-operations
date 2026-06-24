import {
  Check,
  CloudOff,
  RefreshCw,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";
import { useTranslations } from "next-intl";

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
  /** Dictionary key (under `layout.syncPill`) for the visible label. */
  labelKey: string;
  /**
   * Builds the accessible name (richer than the visible label for SR users)
   * from the localized `layout.syncPill` dictionary. The one/many split is a
   * plain JS ternary picking between two keys (no ICU plural).
   */
  aria: (
    s: SyncState,
    t: (key: string, vars?: Record<string, string | number>) => string,
  ) => string;
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
    labelKey: "syncedLabel",
    aria: (_s, t) => t("syncPill.syncedAria"),
    tone: "border-forest-100 bg-forest-50/70 text-forest-700",
    badge: "bg-forest-100 text-forest-700",
  },
  pending: {
    Icon: UploadCloud,
    labelKey: "pendingLabel",
    aria: (s, t) =>
      t(s.pending === 1 ? "syncPill.pendingAriaOne" : "syncPill.pendingAriaMany", {
        n: s.pending,
      }),
    tone: "border-honey-100 bg-honey-100/60 text-honey-700",
    badge: "bg-honey-100 text-honey-700",
    count: (s) => s.pending,
  },
  syncing: {
    Icon: RefreshCw,
    labelKey: "syncingLabel",
    aria: (s, t) =>
      t(s.pending === 1 ? "syncPill.syncingAriaOne" : "syncPill.syncingAriaMany", {
        n: s.pending,
      }),
    // sky-700 (#2a527d) is the darker sky TEXT token for the light sky-100 fill (WCAG
    // AA): 6.26:1 on the solid count badge, 6.77:1 on the sky-100/60 pill body. Plain
    // text-sky only reaches 4.11:1 on the badge — below the floor for the 11px count.
    tone: "border-sky-100 bg-sky-100/60 text-sky-700",
    badge: "bg-sky-100 text-sky-700",
    count: (s) => s.pending,
    spin: true,
  },
  offline: {
    Icon: CloudOff,
    labelKey: "offlineLabel",
    aria: (s, t) =>
      t(s.pending === 1 ? "syncPill.offlineAriaOne" : "syncPill.offlineAriaMany", {
        n: s.pending,
      }),
    tone: "border-line-strong bg-muted/80 text-coffee",
    badge: "bg-coffee-200 text-coffee",
    count: (s) => s.pending,
  },
  failed: {
    Icon: TriangleAlert,
    labelKey: "failedLabel",
    aria: (s, t) =>
      t(s.dead === 1 ? "syncPill.failedAriaOne" : "syncPill.failedAriaMany", {
        n: s.dead,
      }),
    // cherry-700 (#8f3522) is the darker cherry TEXT token for the light cherry-100
    // fill (WCAG AA): 6.0:1 on the solid count badge. Plain text-cherry only reaches
    // 4.69:1 — fine for body, but this 11px font-semibold count uses the darker token.
    tone: "border-cherry-100 bg-cherry-100/70 text-cherry-700",
    badge: "bg-cherry-100 text-cherry-700",
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
  const t = useTranslations("layout");
  const v = VISUALS[state.status];
  const count = v.count?.(state);
  const aria = v.aria(state, t);

  return (
    <button
      type="button"
      data-testid="sync-pill"
      onClick={onClick}
      aria-live="polite"
      aria-label={aria}
      title={aria}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100 motion-safe:hover:-translate-y-px ${v.tone}`}
    >
      <v.Icon
        className={`h-[15px] w-[15px] ${v.spin ? "motion-safe:animate-spin" : ""}`}
        aria-hidden
      />
      <span className="hidden sm:inline">{t(`syncPill.${v.labelKey}`)}</span>
      {typeof count === "number" && count > 0 && (
        <span className={`${COUNT_BADGE} ${v.badge}`}>{count}</span>
      )}
    </button>
  );
}
