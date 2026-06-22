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

  it("single-flights overlapping drains: a reconnect flap during an in-flight send never double-sends a queued entry", async () => {
    // Hold the first transport.send() pending; fire 'online' inside that window
    // (a flapping radio at the mill gate) → the engine's onOnline triggers a
    // second drain while the first is still awaiting. With no single-flight gate
    // on drain(), both drains read entry A as still 'queued' and BOTH call
    // transport.send(A) — a double replay. The gate coalesces them to one send.
    let releaseFirst!: () => void;
    const firstSent = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const sends: string[] = [];
    let i = 0;
    const transport: CommandTransport = {
      async send(entry) {
        sends.push(entry.uuid);
        if (i++ === 0) await firstSent; // hold the FIRST send open.
        return { kind: "ok" };
      },
    };
    const outbox = createOutbox({ store: createMemoryStore(), transport });
    const engine = createSyncEngine({
      outbox,
      win: fakeWindow(),
      nav: fakeNavigator(),
    });
    const a = await outbox.enqueue({
      rpc: "record_weigh_in",
      args: {},
      occurredAt: "2026-06-21T17:00:00.000Z",
      deviceId: "d1",
    });

    const started = engine.start(); // begins draining A; first send hangs.
    await vi.waitFor(() => expect(sends.length).toBe(1)); // A is in-flight.
    emit("online"); // radio flaps → second drain attempt during the window.
    await Promise.resolve();
    releaseFirst(); // let the first send resolve.
    await started;
    await vi.waitFor(() => expect(engine.getState().pending).toBe(0));

    // A must have been sent EXACTLY once across both drain triggers.
    expect(sends.filter((u) => u === a.uuid)).toHaveLength(1);
    engine.stop();
  });

  it("re-drains once for an entry enqueued during an in-flight flush (reconnect mid-flush picks it up, not dropped)", async () => {
    // The single-flight gate must not just DROP an overlapping drain — it must
    // remember it and re-run once, or an entry enqueued mid-flush (a new field
    // write) plus a reconnect during that flush is left 'queued' forever (the
    // in-flight flush already snapshotted without it, and a bare drop-guard
    // never re-drains). The `rerun` flag closes this gap.
    let releaseFirst!: () => void;
    const firstSent = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const sends: string[] = [];
    let i = 0;
    const transport: CommandTransport = {
      async send(entry) {
        sends.push(entry.uuid);
        if (i++ === 0) await firstSent; // hold the FIRST send open.
        return { kind: "ok" };
      },
    };
    const outbox = createOutbox({ store: createMemoryStore(), transport });
    const engine = createSyncEngine({
      outbox,
      win: fakeWindow(),
      nav: fakeNavigator(),
    });
    const a = await outbox.enqueue({
      rpc: "record_weigh_in",
      args: { lot: "A" },
      occurredAt: "2026-06-21T17:00:00.000Z",
      deviceId: "d1",
    });

    const started = engine.start(); // begins draining A; first send hangs.
    await vi.waitFor(() => expect(sends.length).toBe(1)); // A is in-flight.

    // A NEW field write lands mid-flush, and the radio flaps (reconnect).
    const b = await outbox.enqueue({
      rpc: "record_weigh_in",
      args: { lot: "B" },
      occurredAt: "2026-06-21T17:00:05.000Z",
      deviceId: "d1",
    });
    emit("online"); // second drain attempt while the first flush is in flight.
    await Promise.resolve();
    releaseFirst(); // let A's send resolve.
    await started;

    // Both A and B must end up sent — B is NOT stranded in the queue.
    await vi.waitFor(() => {
      expect(engine.getState().pending).toBe(0);
      expect(engine.getState().status).toBe("synced");
    });
    expect(sends).toContain(a.uuid);
    expect(sends).toContain(b.uuid);
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
