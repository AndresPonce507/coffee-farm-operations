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
});
