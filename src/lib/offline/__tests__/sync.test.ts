import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "@/lib/offline/storage";
import {
  createOutbox,
  type CommandTransport,
  type TransportResult,
} from "@/lib/offline/outbox";
import { createSyncEngine, deriveSyncState } from "@/lib/offline/sync";

/**
 * The sync engine watches connectivity and drains the outbox on reconnect, and
 * projects a single `SyncState` the pill renders. `deriveSyncState` is the pure
 * projection (tested in isolation); `createSyncEngine` is the live wiring over
 * `navigator.onLine` + the online/offline events (tested with mocked globals).
 */

function scriptedTransport(results: TransportResult[]): CommandTransport {
  let i = 0;
  return {
    async send() {
      return results[i++] ?? { kind: "ok" };
    },
  };
}

describe("deriveSyncState (pure projection)", () => {
  it("offline → 'offline' regardless of queue depth", () => {
    expect(
      deriveSyncState({ online: false, pending: 3, dead: 0, syncing: false }),
    ).toBe("offline");
  });

  it("online + syncing → 'syncing'", () => {
    expect(
      deriveSyncState({ online: true, pending: 2, dead: 0, syncing: true }),
    ).toBe("syncing");
  });

  it("online + pending but idle → 'pending'", () => {
    expect(
      deriveSyncState({ online: true, pending: 2, dead: 0, syncing: false }),
    ).toBe("pending");
  });

  it("any dead-letters → 'failed' (takes precedence while online)", () => {
    expect(
      deriveSyncState({ online: true, pending: 0, dead: 1, syncing: false }),
    ).toBe("failed");
  });

  it("online, nothing queued, nothing failed → 'synced'", () => {
    expect(
      deriveSyncState({ online: true, pending: 0, dead: 0, syncing: false }),
    ).toBe("synced");
  });
});

describe("createSyncEngine (connectivity wiring)", () => {
  let onlineNow = true;
  const listeners: Record<string, Array<() => void>> = {};

  function fakeWindow() {
    return {
      addEventListener: (ev: string, cb: () => void) => {
        (listeners[ev] ??= []).push(cb);
      },
      removeEventListener: (ev: string, cb: () => void) => {
        listeners[ev] = (listeners[ev] ?? []).filter((c) => c !== cb);
      },
    } as unknown as Window;
  }
  const fakeNavigator = () =>
    ({ get onLine() {
        return onlineNow;
      } }) as unknown as Navigator;

  function emit(ev: "online" | "offline") {
    onlineNow = ev === "online";
    (listeners[ev] ?? []).forEach((cb) => cb());
  }

  beforeEach(() => {
    onlineNow = true;
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  it("starts 'synced' on an empty queue while online", async () => {
    const outbox = createOutbox({
      store: createMemoryStore(),
      transport: scriptedTransport([]),
    });
    const engine = createSyncEngine({
      outbox,
      win: fakeWindow(),
      nav: fakeNavigator(),
    });
    await engine.refresh();
    expect(engine.getState().status).toBe("synced");
    engine.stop();
  });

  it("reports 'offline' and holds the queue when offline", async () => {
    onlineNow = false;
    const outbox = createOutbox({
      store: createMemoryStore(),
      transport: scriptedTransport([{ kind: "ok" }]),
    });
    const engine = createSyncEngine({
      outbox,
      win: fakeWindow(),
      nav: fakeNavigator(),
    });
    await outbox.enqueue({
      rpc: "record_weigh_in",
      args: {},
      occurredAt: "2026-06-21T17:00:00.000Z",
      deviceId: "d1",
    });
    await engine.refresh();
    expect(engine.getState().status).toBe("offline");
    expect(engine.getState().pending).toBe(1);
    engine.stop();
  });

  it("auto-flushes the queue when the device comes back online", async () => {
    onlineNow = false;
    const outbox = createOutbox({
      store: createMemoryStore(),
      transport: scriptedTransport([{ kind: "ok" }]),
    });
    const engine = createSyncEngine({
      outbox,
      win: fakeWindow(),
      nav: fakeNavigator(),
    });
    await outbox.enqueue({
      rpc: "record_weigh_in",
      args: {},
      occurredAt: "2026-06-21T17:00:00.000Z",
      deviceId: "d1",
    });
    await engine.start();
    expect(engine.getState().pending).toBe(1);

    // wifi returns → the engine drains automatically.
    emit("online");
    await vi.waitFor(() => {
      expect(engine.getState().pending).toBe(0);
      expect(engine.getState().status).toBe("synced");
    });
    engine.stop();
  });

  it("notifies subscribers on every state change", async () => {
    const outbox = createOutbox({
      store: createMemoryStore(),
      transport: scriptedTransport([{ kind: "ok" }]),
    });
    const engine = createSyncEngine({
      outbox,
      win: fakeWindow(),
      nav: fakeNavigator(),
    });
    const seen: string[] = [];
    const unsub = engine.subscribe((s) => seen.push(s.status));
    await engine.start();
    await outbox.enqueue({
      rpc: "record_weigh_in",
      args: {},
      occurredAt: "2026-06-21T17:00:00.000Z",
      deviceId: "d1",
    });
    await engine.refresh();
    expect(seen.length).toBeGreaterThan(0);
    unsub();
    engine.stop();
  });
});
