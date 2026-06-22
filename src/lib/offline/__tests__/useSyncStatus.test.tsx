import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "@/lib/offline/storage";
import {
  createOutbox,
  type CommandTransport,
  type TransportResult,
} from "@/lib/offline/outbox";
import { createSyncEngine } from "@/lib/offline/sync";

/**
 * `useSyncStatus()` is the interaction layer behind the sync pill + outbox
 * drawer — the operator's ONLY manual recovery affordance for a dead-letter.
 *
 * The load-bearing behaviour: tapping "Retry" (and the manual "sync now" flush)
 * must actually DRIVE A SEND, not merely recompute the badge. A revived
 * dead-letter that just flips dead→queued and sits there forever (because the
 * follow-up only `refresh()`ed the counts) is the regression these tests pin:
 * `retry()` re-invokes the transport and the entry reaches `done` while online.
 */

let onlineNow = true;

/** A scripted transport that records each send so we can assert re-invocation. */
function scriptedTransport(
  results: TransportResult[],
): CommandTransport & { sends: string[] } {
  const sends: string[] = [];
  let i = 0;
  return {
    sends,
    async send(entry) {
      sends.push(entry.idempotencyKey);
      return results[i++] ?? { kind: "ok" };
    },
  };
}

/** Build a real outbox+engine over an in-memory store and a fake connectivity.
 * `emit('online'|'offline')` drives a real connectivity transition through the
 * engine's window listeners (exactly as the OS does), keeping its cached online
 * state honest — the same capturing-window pattern as sync.test.ts. */
function makeRuntime(transport: CommandTransport) {
  const listeners: Record<string, Array<() => void>> = {};
  const win = {
    addEventListener: (ev: string, cb: () => void) => {
      (listeners[ev] ??= []).push(cb);
    },
    removeEventListener: (ev: string, cb: () => void) => {
      listeners[ev] = (listeners[ev] ?? []).filter((c) => c !== cb);
    },
  } as unknown as Window;
  const outbox = createOutbox({ store: createMemoryStore(), transport });
  const engine = createSyncEngine({
    outbox,
    win,
    // navigator.onLine is read live off `onlineNow`.
    nav: {
      get onLine() {
        return onlineNow;
      },
    },
  });
  const emit = (ev: "online" | "offline") => {
    onlineNow = ev === "online";
    (listeners[ev] ?? []).forEach((cb) => cb());
  };
  return { outbox, engine, emit };
}

const baseCmd = {
  rpc: "record_weigh_in",
  args: { p_kg: 12.4 },
  occurredAt: "2026-06-21T17:00:00.000Z",
  deviceId: "dev-1",
};

afterEach(() => {
  onlineNow = true;
  vi.resetModules();
});

/** Mock the tab-singleton runtime to the test's deterministic instance, then
 * import the hook (which reads getRuntime at call time). */
async function renderSyncStatus(runtime: {
  outbox: ReturnType<typeof createOutbox>;
  engine: ReturnType<typeof createSyncEngine>;
}) {
  vi.doMock("@/lib/offline/runtime", () => ({ getRuntime: () => runtime }));
  const { useSyncStatus } = await import("@/lib/offline/useSyncStatus");
  return renderHook(() => useSyncStatus());
}

describe("useSyncStatus — manual recovery actually drives a send", () => {
  it("retry() on a dead-letter re-invokes the transport and reaches 'done' while online", async () => {
    // first attempt → business rejection (dead-letter); second → ok (the fix).
    const transport = scriptedTransport([
      { kind: "rejected", message: "reposo gate: lot not rest-stable" },
      { kind: "ok" },
    ]);
    const runtime = makeRuntime(transport);

    // Enqueue + drain to a dead-letter (the field rejection the operator fixes).
    const entry = await runtime.outbox.enqueue(baseCmd);
    await runtime.outbox.flush();
    expect(await runtime.outbox.deadLetters()).toHaveLength(1);
    expect(transport.sends).toHaveLength(1);

    const { result } = await renderSyncStatus(runtime);
    await waitFor(() => expect(result.current.deadLetters).toHaveLength(1));

    // The operator taps "Retry" in the drawer (online).
    await act(async () => {
      await result.current.retry(entry.uuid);
    });

    // The transport was invoked a SECOND time AND the entry actually delivered —
    // not left sitting 'queued'/'pending' waiting for a connectivity toggle.
    expect(transport.sends).toHaveLength(2);
    expect(await runtime.outbox.pendingCount()).toBe(0);
    expect(await runtime.outbox.deadLetters()).toHaveLength(0);
    const all = await runtime.outbox.list();
    expect(all[0].status).toBe("done");
  });

  it("flush() (manual 'sync now') sends a still-queued entry instead of just recomputing counts", async () => {
    // First attempt (the engine's mount-drain) fails on the network → the entry
    // STAYS queued. The operator then taps "sync now"; the second attempt is ok.
    const transport = scriptedTransport([
      { kind: "network-error", message: "Failed to fetch" },
      { kind: "ok" },
    ]);
    const runtime = makeRuntime(transport);

    await runtime.outbox.enqueue(baseCmd);

    const { result } = await renderSyncStatus(runtime);
    // The mount-drain attempted once (network-error) and left it queued.
    await waitFor(() => {
      expect(transport.sends).toHaveLength(1);
      expect(result.current.pending).toHaveLength(1);
    });

    // Manual "sync now": this must drive a real send, not just recompute counts.
    await act(async () => {
      await result.current.flush();
    });

    expect(transport.sends).toHaveLength(2);
    expect(await runtime.outbox.pendingCount()).toBe(0);
  });

  it("retry() while OFFLINE re-queues but safely does not pretend to send", async () => {
    const transport = scriptedTransport([
      { kind: "rejected", message: "rejected" },
    ]);
    const runtime = makeRuntime(transport);

    const entry = await runtime.outbox.enqueue(baseCmd);
    await runtime.outbox.flush();
    expect(await runtime.outbox.deadLetters()).toHaveLength(1);

    const { result } = await renderSyncStatus(runtime);
    await waitFor(() => expect(result.current.deadLetters).toHaveLength(1));

    // The device drops connectivity (real OS transition through the engine's
    // listener). The operator then taps Retry: the entry revives to queued and
    // is held safely — no transport attempt — to drain on the next reconnect.
    await act(async () => {
      runtime.emit("offline");
    });
    await act(async () => {
      await result.current.retry(entry.uuid);
    });

    expect(transport.sends).toHaveLength(1); // no new send while offline.
    expect(await runtime.outbox.pendingCount()).toBe(1); // revived & queued.
    expect(await runtime.outbox.deadLetters()).toHaveLength(0);
  });
});
