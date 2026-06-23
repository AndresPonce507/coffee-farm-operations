import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncStatusPill } from "@/components/layout/sync-status";
import type { SyncState } from "@/lib/offline/sync";

/**
 * The sync pill is the always-visible chrome that tells a picker in a dead zone
 * their weigh-in is safe. It is a pure, presentational render of a `SyncState`
 * (the stateful island wraps it) so its five states are render-testable in
 * jsdom with no IndexedDB. World-class = legible + accessible: a live region,
 * an accessible name per state, GPU-only animation, reduced-motion safe.
 */

function state(partial: Partial<SyncState>): SyncState {
  return {
    status: "synced",
    online: true,
    pending: 0,
    dead: 0,
    syncing: false,
    ...partial,
  };
}

describe("SyncStatusPill", () => {
  it("renders a polite live region so screen readers hear status changes", () => {
    render(<SyncStatusPill state={state({})} />);
    const pill = screen.getByTestId("sync-pill");
    expect(pill).toHaveAttribute("aria-live", "polite");
  });

  it("'synced' state reads as up to date", () => {
    render(<SyncStatusPill state={state({ status: "synced" })} />);
    expect(screen.getByTestId("sync-pill")).toHaveAccessibleName(/up to date|synced|saved/i);
  });

  it("'offline' state names itself offline and shows the queued count", () => {
    render(
      <SyncStatusPill state={state({ status: "offline", online: false, pending: 3 })} />,
    );
    const pill = screen.getByTestId("sync-pill");
    expect(pill).toHaveAccessibleName(/offline/i);
    expect(within(pill).getByText(/3/)).toBeInTheDocument();
  });

  it("'pending' state surfaces N queued waiting to sync", () => {
    render(<SyncStatusPill state={state({ status: "pending", pending: 2 })} />);
    const pill = screen.getByTestId("sync-pill");
    expect(pill).toHaveAccessibleName(/queued|waiting|2/i);
    expect(within(pill).getByText(/2/)).toBeInTheDocument();
  });

  it("'syncing' state announces it is syncing", () => {
    render(<SyncStatusPill state={state({ status: "syncing", syncing: true, pending: 1 })} />);
    expect(screen.getByTestId("sync-pill")).toHaveAccessibleName(/syncing/i);
  });

  it("'failed' state surfaces the dead-letter count prominently", () => {
    render(<SyncStatusPill state={state({ status: "failed", dead: 2 })} />);
    const pill = screen.getByTestId("sync-pill");
    expect(pill).toHaveAccessibleName(/fail|attention|2/i);
    expect(within(pill).getByText(/2/)).toBeInTheDocument();
  });

  it("is a button so the operator can open the outbox drawer", () => {
    render(<SyncStatusPill state={state({ status: "pending", pending: 1 })} />);
    expect(screen.getByTestId("sync-pill").tagName).toBe("BUTTON");
  });

  /**
   * WCAG-AA regression (P2-S0 finding #81): the syncing/failed count badge put
   * text-sky #3b6ea5 on solid sky-100 (4.11:1) and text-cherry #b5482e on solid
   * cherry-100 (4.12:1) at 11px font-semibold — below the 4.5:1 floor for normal
   * text. The count is the load-bearing datum, so it must clear AA. Fixed by
   * darkening the text to AA-clearing tones (#2a527d sky → 6.26:1 on the badge,
   * #9e3a22 cherry → 5.26:1). jsdom can't measure rendered contrast, so we assert
   * the AA-clearing tone is on the badge AND the old failing tone is gone.
   */
  it("'syncing' badge uses an AA-clearing dark text tone, not the failing text-sky", () => {
    render(<SyncStatusPill state={state({ status: "syncing", syncing: true, pending: 3 })} />);
    const badge = within(screen.getByTestId("sync-pill")).getByText("3");
    expect(badge.className).toContain("text-sky-700");
    expect(badge.className).not.toMatch(/(^|\s)text-sky(\s|$)/);
  });

  it("'failed' badge uses an AA-clearing dark text tone, not the failing text-cherry", () => {
    render(<SyncStatusPill state={state({ status: "failed", dead: 2 })} />);
    const badge = within(screen.getByTestId("sync-pill")).getByText("2");
    expect(badge.className).toContain("text-cherry-700");
    expect(badge.className).not.toMatch(/(^|\s)text-cherry(\s|$)/);
  });

  it("'syncing' pill body also carries the AA-clearing dark sky text tone", () => {
    render(<SyncStatusPill state={state({ status: "syncing", syncing: true, pending: 1 })} />);
    const pill = screen.getByTestId("sync-pill");
    expect(pill.className).toContain("text-sky-700");
    expect(pill.className).not.toMatch(/(^|\s)text-sky(\s|$)/);
  });

  it("'failed' pill body also carries the AA-clearing dark cherry text tone", () => {
    render(<SyncStatusPill state={state({ status: "failed", dead: 1 })} />);
    const pill = screen.getByTestId("sync-pill");
    expect(pill.className).toContain("text-cherry-700");
    expect(pill.className).not.toMatch(/(^|\s)text-cherry(\s|$)/);
  });
});
