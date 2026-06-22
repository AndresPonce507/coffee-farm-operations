import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The island reads the tab-singleton runtime; stub it so the test drives a
// deterministic engine + outbox with an in-memory store. This suite seeds a
// DEAD-LETTER so the drawer renders with real focusable controls (Retry /
// Dismiss), which is what makes the modal-contract assertions meaningful
// (FINDINGS #79 + #80 — focus-into / focus-trap / scroll-lock / Escape).
import { createMemoryStore } from "@/lib/offline/storage";
import { createOutbox } from "@/lib/offline/outbox";
import { createSyncEngine } from "@/lib/offline/sync";

const store = createMemoryStore();
// A transport that REJECTS, so a flushed command dead-letters and the drawer
// renders the "Needs attention" section with Retry + Dismiss buttons.
const outbox = createOutbox({
  store,
  transport: {
    async send() {
      return { kind: "rejected", message: "rejected by the server" };
    },
  },
});
const engine = createSyncEngine({
  outbox,
  win: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  nav: { onLine: true },
});

vi.mock("@/lib/offline/runtime", () => ({
  getRuntime: () => ({ outbox, engine }),
}));

import { SyncStatus } from "@/components/layout/sync-status-island";

// vitest config has no globals; register RTL cleanup explicitly so each test
// renders into a fresh document body.
afterEach(async () => {
  cleanup();
  document.body.style.overflow = "";
  // Drain the module-level store so each test starts from an empty queue
  // (otherwise dead-letters accumulate and the drawer renders duplicate
  // Retry/Dismiss controls across tests).
  for (const e of await outbox.list()) await outbox.dismiss(e.uuid);
});

beforeEach(async () => {
  // Seed exactly one dead-letter so the drawer has focusable controls.
  await outbox.enqueue({
    rpc: "record_weigh_in",
    args: {},
    occurredAt: new Date().toISOString(),
    deviceId: "dev-1",
  });
  await outbox.flush();
});

/** Open the island's outbox drawer by clicking the pill; return its node. */
async function openDrawer() {
  render(<SyncStatus />);
  const pill = await screen.findByTestId("sync-pill");
  pill.focus();
  expect(document.activeElement).toBe(pill);
  fireEvent.click(pill);
  const dialog = await screen.findByRole("dialog");
  // The seeded dead-letter must be visible so the trap has something to grab.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument(),
  );
  return { dialog, pill };
}

describe("SyncStatus outbox drawer — modal contract", () => {
  // FINDING #79 — on open, focus must move INTO the drawer (was: focus stranded
  // on the pill button OUTSIDE the portal).
  it("moves focus into the drawer on open", async () => {
    const { dialog } = await openDrawer();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  // FINDING #79 — Tab from the last focusable wraps to the first (forward trap),
  // so Tab never walks out of the "modal" into the page behind it.
  it("traps Tab at the end back to the first focusable element", async () => {
    const { dialog } = await openDrawer();
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  // FINDING #79 — Shift+Tab from the first focusable wraps to the last (back trap).
  it("traps Shift+Tab at the start back to the last focusable element", async () => {
    const { dialog } = await openDrawer();
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  // FINDING #79 — body scroll is locked while the drawer is open, restored on close.
  it("locks body scroll while open and restores it on close", async () => {
    const { dialog } = await openDrawer();
    expect(document.body.style.overflow).toBe("hidden");

    // Close via the header X button.
    fireEvent.click(screen.getByLabelText("Close sync activity"));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("");
  });

  // FINDING #79 — closing restores focus to the trigger pill (was: focus orphaned
  // to <body>). Guard against a FALSE pass: first prove focus actually moved INTO
  // the drawer (pre-fix it never does, so this line fails on the old code), then
  // move focus deeper into the drawer and assert close returns it to the pill —
  // distinguishing real restore from "focus never left the pill in the first
  // place".
  it("restores focus to the pill on close", async () => {
    const { dialog, pill } = await openDrawer();
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Land on a control inside the drawer (a keyboard user tabbing around).
    screen.getByLabelText("Close sync activity").focus();
    expect(document.activeElement).not.toBe(pill);

    fireEvent.click(screen.getByLabelText("Close sync activity"));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(document.activeElement).toBe(pill);
  });

  // FINDING #80 — Escape closes the drawer even though focus started on the pill
  // (OUTSIDE the portal). The handler must be document-level, NOT an in-subtree
  // React onKeyDown. Dispatch Escape on `document` (NOT the dialog node) so a
  // naive in-subtree handler would NOT catch it — mirroring the real bug.
  it("closes on Escape dispatched at the document level", async () => {
    const { dialog } = await openDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
});
