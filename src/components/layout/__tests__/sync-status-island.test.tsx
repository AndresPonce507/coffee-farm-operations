import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The island reads the tab-singleton runtime; stub it so the test drives a
// deterministic engine + outbox with an in-memory store.
import { createMemoryStore } from "@/lib/offline/storage";
import { createOutbox } from "@/lib/offline/outbox";
import { createSyncEngine } from "@/lib/offline/sync";

const store = createMemoryStore();
const outbox = createOutbox({
  store,
  transport: { async send() { return { kind: "ok" }; } },
});
const engine = createSyncEngine({
  outbox,
  // jsdom navigator.onLine defaults to true; supply a fake window so the engine
  // can add/remove listeners without touching the real one.
  win: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  nav: { onLine: true },
});

vi.mock("@/lib/offline/runtime", () => ({
  getRuntime: () => ({ outbox, engine }),
}));

import { SyncStatus } from "@/components/layout/sync-status-island";

describe("SyncStatus island", () => {
  it("renders the pill (synced on an empty queue)", async () => {
    render(<SyncStatus />);
    await waitFor(() =>
      expect(screen.getByTestId("sync-pill")).toBeInTheDocument(),
    );
  });

  it("opens the outbox drawer when the pill is clicked", async () => {
    render(<SyncStatus />);
    const pill = await screen.findByTestId("sync-pill");
    fireEvent.click(pill);
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeInTheDocument(),
    );
    // the drawer names itself (the activity-centre heading).
    expect(
      screen.getByRole("dialog", { name: /sync|offline|activity/i }),
    ).toBeInTheDocument();
  });
});
