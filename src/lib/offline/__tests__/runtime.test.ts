import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The offline runtime (P2-S0/S2) — the tab-singleton that wires the durable
 * outbox to the SHIPPED `routerTransport` and registers the field-capture
 * commands. Two things this suite pins, both of which were previously untested:
 *
 *  (139) `routerTransport`'s three-way classification — the copy that ACTUALLY
 *        ships in the singleton outbox (transport.ts's tested copy is never
 *        wired into a production `createOutbox`). unregistered rpc → dead-letter
 *        with a clear message (never a silent {ok}); action resolves !ok →
 *        dead-letter; action THROWS → STAYS queued (network-error, retryable).
 *
 *  (145) the genesis field event — `record_weigh_in` — IS registered, so an
 *        offline-captured weigh-in drains to the Server Action on reconnect
 *        instead of dead-lettering forever (silent field-data loss). The queued
 *        `p_*` RPC envelope is mapped back onto the camelCase form fields the
 *        action consumes, a success marks the entry `done`, a deterministic
 *        rejection dead-letters it, and a thrown action keeps it queued.
 *
 * `getRuntime()` memoizes a module-level singleton and the registry is
 * module-global, so each case `vi.resetModules()` + re-imports for isolation.
 */

const baseEntry = {
  rpc: "record_weigh_in",
  args: { p_worker_id: "w1" },
  occurredAt: "2026-06-21T17:00:00.000Z",
  deviceId: "dev-1",
};

/** A spy the mocked Server Action records its calls into (reset per test). */
const recordWeighInActionSpy = vi.fn();

beforeEach(() => {
  vi.resetModules();
  recordWeighInActionSpy.mockReset();
  // The runtime lazily imports the weigh Server Action; mock it so the heavy
  // `"use server"` graph (next/cache, Supabase) never loads under jsdom.
  vi.doMock("@/app/(app)/weigh/actions", () => ({
    recordWeighInAction: recordWeighInActionSpy,
  }));
  // No flag mock here: jsdom has no real IndexedDB, so `offlineCapable()` is
  // false and `getRuntime()` selects the in-memory store via its real branch —
  // exactly the graceful-degradation path. Cases that need the store-selection
  // branch covered drive `offlineEnabled` explicitly.
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("runtime — shipped routerTransport classification (139)", () => {
  it("dead-letters an UNregistered rpc with a clear message (never a silent ok)", async () => {
    const { getRuntime } = await import("@/lib/offline/runtime");
    const { outbox } = getRuntime();

    await outbox.enqueue({ ...baseEntry, rpc: "no_such_rpc" });
    const summary = await outbox.flush();

    expect(summary.deadLettered).toBe(1);
    expect(summary.sent).toBe(0);
    const dead = await outbox.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0].lastError).toMatch(/No handler registered/);

    // …and it is retryable — reviving it puts it back to queued (not dropped).
    await outbox.retry(dead[0].uuid);
    expect(await outbox.pendingCount()).toBe(1);
    expect(await outbox.deadLetters()).toHaveLength(0);
  });

  it("a registered action resolving !ok → dead-letters carrying the message", async () => {
    const { getRuntime, registerCommand } = await import(
      "@/lib/offline/runtime"
    );
    registerCommand("test_rpc", async () => ({
      ok: false as const,
      message: "reposo gate: not rest-stable",
    }));
    const { outbox } = getRuntime();

    await outbox.enqueue({ ...baseEntry, rpc: "test_rpc" });
    const summary = await outbox.flush();

    expect(summary.deadLettered).toBe(1);
    const dead = await outbox.deadLetters();
    expect(dead[0].lastError).toMatch(/reposo gate/);
  });

  it("a registered action that THROWS keeps the entry queued (network-error, retryable)", async () => {
    const { getRuntime, registerCommand } = await import(
      "@/lib/offline/runtime"
    );
    registerCommand("test_rpc", async () => {
      throw new TypeError("Failed to fetch");
    });
    const { outbox } = getRuntime();

    await outbox.enqueue({ ...baseEntry, rpc: "test_rpc" });
    const summary = await outbox.flush();

    // The keystone regression: a thrown (transient) action must NOT dead-letter.
    expect(summary.failed).toBe(1);
    expect(summary.deadLettered).toBe(0);
    expect(await outbox.pendingCount()).toBe(1);
    expect(await outbox.deadLetters()).toHaveLength(0);
  });

  it("a registered action resolving ok → marks the entry done", async () => {
    const { getRuntime, registerCommand } = await import(
      "@/lib/offline/runtime"
    );
    registerCommand("test_rpc", async () => ({ ok: true as const }));
    const { outbox } = getRuntime();

    await outbox.enqueue({ ...baseEntry, rpc: "test_rpc" });
    const summary = await outbox.flush();

    expect(summary.sent).toBe(1);
    const all = await outbox.list();
    expect(all[0].status).toBe("done");
  });
});

describe("runtime — singleton + store selection", () => {
  it("getRuntime() returns the same object across calls (stable per-tab singleton)", async () => {
    const { getRuntime } = await import("@/lib/offline/runtime");
    expect(getRuntime()).toBe(getRuntime());
  });

  it("with offlineEnabled()===false getRuntime() selects the in-memory store", async () => {
    // Force the disabled branch (online-only) — it must build over the memory
    // store and stay fully functional (no IndexedDB touched).
    vi.doMock("@/lib/offline/flag", () => ({
      offlineEnabled: () => false,
      offlineFlagEnabled: () => false,
      offlineCapable: () => false,
    }));
    const { getRuntime, registerCommand } = await import(
      "@/lib/offline/runtime"
    );
    registerCommand("test_rpc", async () => ({ ok: true as const }));
    const { outbox } = getRuntime();

    // A full enqueue→flush cycle works against the in-memory store.
    await outbox.enqueue({ ...baseEntry, rpc: "test_rpc" });
    const summary = await outbox.flush();
    expect(summary.sent).toBe(1);
  });
});

describe("runtime — record_weigh_in is registered and drains (145)", () => {
  /** The queued envelope a real offline weigh-in produces (snake_case args). */
  const weighEntry = {
    rpc: "record_weigh_in",
    args: {
      p_worker_id: "worker-7",
      p_plot_id: "plot-3",
      p_cherries_kg: 12.4,
      p_ripeness: "ripe",
      p_brix: null,
      p_scale_source: "manual",
      p_captured_lat: 8.7,
      p_captured_lng: -82.6,
      p_occurred_at: "2026-06-21T17:00:00.000Z",
      p_device_id: "weigh-abc",
      p_device_seq: 0,
      p_idempotency_key: "idem-123",
    },
    occurredAt: "2026-06-21T17:00:00.000Z",
    deviceId: "weigh-abc",
    idempotencyKey: "idem-123",
  };

  it("drains a queued weigh-in through the real Server Action and marks it done", async () => {
    recordWeighInActionSpy.mockResolvedValue({
      status: "success",
      message: "Weight captured.",
      lotCode: "L-1",
    });
    const { getRuntime } = await import("@/lib/offline/runtime");
    const { outbox } = getRuntime();

    await outbox.enqueue(weighEntry);
    const summary = await outbox.flush();

    // It reached the action (not dead-lettered for "No handler registered").
    expect(recordWeighInActionSpy).toHaveBeenCalledTimes(1);
    expect(summary.sent).toBe(1);
    expect(summary.deadLettered).toBe(0);
    const all = await outbox.list();
    expect(all[0].status).toBe("done");

    // The queued p_* envelope was mapped back to the camelCase FormData fields
    // the Server Action reads (plus the outbox-stamped device_seq).
    const form = recordWeighInActionSpy.mock.calls[0][0] as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("workerId")).toBe("worker-7");
    expect(form.get("plotId")).toBe("plot-3");
    expect(form.get("cherriesKg")).toBe("12.4");
    expect(form.get("ripeness")).toBe("ripe");
    expect(form.get("scaleSource")).toBe("manual");
    expect(form.get("idempotencyKey")).toBe("idem-123");
    // device_seq is the outbox-stamped monotonic value (>= 1), not the raw 0.
    expect(Number(form.get("deviceSeq"))).toBeGreaterThanOrEqual(1);
    expect(form.get("deviceId")).toBe("weigh-abc");
  });

  it("dead-letters a weigh-in the Server Action deterministically rejects", async () => {
    recordWeighInActionSpy.mockResolvedValue({
      status: "error",
      message: "worker is not on today's active crew",
    });
    const { getRuntime } = await import("@/lib/offline/runtime");
    const { outbox } = getRuntime();

    await outbox.enqueue(weighEntry);
    const summary = await outbox.flush();

    expect(summary.deadLettered).toBe(1);
    const dead = await outbox.deadLetters();
    expect(dead[0].lastError).toMatch(/active crew/);
  });

  it("keeps a weigh-in queued when the Server Action throws (offline/network)", async () => {
    recordWeighInActionSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    const { getRuntime } = await import("@/lib/offline/runtime");
    const { outbox } = getRuntime();

    await outbox.enqueue(weighEntry);
    const summary = await outbox.flush();

    expect(summary.failed).toBe(1);
    expect(summary.deadLettered).toBe(0);
    expect(await outbox.pendingCount()).toBe(1);
  });
});
