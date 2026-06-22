import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "@/lib/offline/storage";
import {
  createOutbox,
  type CommandTransport,
  type TransportResult,
} from "@/lib/offline/outbox";

/**
 * The outbox is the heart of the offline write contract (P2-S0):
 *   - enqueue a command while offline (it lands "queued", durable),
 *   - flush() drains FIFO and calls the transport (the Server Action),
 *   - on idempotent success the entry is "done" (and a SECOND flush of the same
 *     entry is a no-op — exactly-once under replay, proven here),
 *   - a NETWORK failure leaves the entry "queued" (retried next reconnect),
 *   - a BUSINESS rejection moves the entry to "dead" (dead-letter) — surfaced,
 *     NEVER silently dropped, and NEVER retried.
 *
 * The two failure paths must NOT be confused — that is the single most
 * load-bearing behaviour in the slice.
 */

/** A scripted transport: each call pops the next queued result. */
function scriptedTransport(
  results: TransportResult[],
): CommandTransport & { calls: { rpc: string; idempotencyKey: string }[] } {
  const calls: { rpc: string; idempotencyKey: string }[] = [];
  let i = 0;
  return {
    calls,
    async send(cmd) {
      calls.push({ rpc: cmd.rpc, idempotencyKey: cmd.idempotencyKey });
      const r = results[i++] ?? { kind: "ok" };
      return r;
    },
  };
}

const baseCmd = {
  rpc: "record_weigh_in",
  args: { p_kg: 12.4 },
  occurredAt: "2026-06-21T17:00:00.000Z",
  deviceId: "dev-1",
};

describe("outbox", () => {
  let store = createMemoryStore();

  beforeEach(() => {
    store = createMemoryStore();
  });

  it("enqueue persists a queued entry with a minted uuid + idempotency key", async () => {
    const outbox = createOutbox({ store, transport: scriptedTransport([]) });
    const entry = await outbox.enqueue(baseCmd);

    expect(entry.status).toBe("queued");
    expect(entry.uuid).toMatch(/^[0-9a-f-]{36}$/);
    // the uuid IS the exactly-once anchor by default.
    expect(entry.idempotencyKey).toBe(entry.uuid);
    expect(entry.deviceSeq).toBeTypeOf("number");

    const persisted = await outbox.list();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].uuid).toBe(entry.uuid);
  });

  it("assigns a strictly-increasing device_seq per enqueue", async () => {
    const outbox = createOutbox({ store, transport: scriptedTransport([]) });
    const a = await outbox.enqueue(baseCmd);
    const b = await outbox.enqueue(baseCmd);
    const c = await outbox.enqueue(baseCmd);
    expect(b.deviceSeq).toBeGreaterThan(a.deviceSeq);
    expect(c.deviceSeq).toBeGreaterThan(b.deviceSeq);
  });

  it("flush drains queued entries FIFO and marks them done on success", async () => {
    const transport = scriptedTransport([{ kind: "ok" }, { kind: "ok" }]);
    const outbox = createOutbox({ store, transport });

    const first = await outbox.enqueue({ ...baseCmd, args: { p_kg: 1 } });
    const second = await outbox.enqueue({ ...baseCmd, args: { p_kg: 2 } });

    const summary = await outbox.flush();
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.deadLettered).toBe(0);

    // FIFO order preserved (first enqueued sent first).
    expect(transport.calls[0].idempotencyKey).toBe(first.idempotencyKey);
    expect(transport.calls[1].idempotencyKey).toBe(second.idempotencyKey);

    expect(await outbox.pendingCount()).toBe(0);
  });

  it("is exactly-once under replay: flushing a done entry never re-sends it", async () => {
    const transport = scriptedTransport([{ kind: "ok" }]);
    const outbox = createOutbox({ store, transport });

    await outbox.enqueue(baseCmd);
    await outbox.flush();
    await outbox.flush(); // a second drain — the entry is already done.

    // the transport was called exactly once — the second flush is a no-op.
    expect(transport.calls).toHaveLength(1);
  });

  it("re-uses the SAME idempotency key when a queued entry is retried", async () => {
    // first attempt fails on the network, second attempt succeeds — both must
    // carry the identical idempotency key so the DB dedupes them to one row.
    const transport = scriptedTransport([
      { kind: "network-error", message: "offline" },
      { kind: "ok" },
    ]);
    const outbox = createOutbox({ store, transport });

    const entry = await outbox.enqueue(baseCmd);
    await outbox.flush(); // network-error → stays queued
    await outbox.flush(); // ok → done

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0].idempotencyKey).toBe(entry.idempotencyKey);
    expect(transport.calls[1].idempotencyKey).toBe(entry.idempotencyKey);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it("NETWORK failure leaves the entry queued (retried later, not dropped)", async () => {
    const transport = scriptedTransport([
      { kind: "network-error", message: "Failed to fetch" },
    ]);
    const outbox = createOutbox({ store, transport });

    await outbox.enqueue(baseCmd);
    const summary = await outbox.flush();

    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(0);
    expect(summary.deadLettered).toBe(0);

    const entries = await outbox.list();
    expect(entries[0].status).toBe("queued");
    expect(await outbox.pendingCount()).toBe(1);
  });

  it("BUSINESS rejection dead-letters the entry (visible, never retried)", async () => {
    const transport = scriptedTransport([
      { kind: "rejected", message: "reposo gate: lot not rest-stable" },
    ]);
    const outbox = createOutbox({ store, transport });

    await outbox.enqueue(baseCmd);
    const summary = await outbox.flush();

    expect(summary.deadLettered).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.sent).toBe(0);

    const dead = await outbox.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0].status).toBe("dead");
    expect(dead[0].lastError).toMatch(/reposo gate/);

    // a dead entry is NOT pending and is NOT retried by a subsequent flush.
    expect(await outbox.pendingCount()).toBe(0);
    await outbox.flush();
    expect(transport.calls).toHaveLength(1); // still just the one attempt.
  });

  it("the two failure paths are not confused (network ≠ business)", async () => {
    // one of each, enqueued together; after a flush exactly one is queued and
    // exactly one is dead — never both-queued or both-dead.
    const transport = scriptedTransport([
      { kind: "network-error", message: "offline" },
      { kind: "rejected", message: "min wage make-whole violated" },
    ]);
    const outbox = createOutbox({ store, transport });

    await outbox.enqueue({ ...baseCmd, args: { a: 1 } });
    await outbox.enqueue({ ...baseCmd, args: { a: 2 } });
    await outbox.flush();

    expect(await outbox.pendingCount()).toBe(1);
    expect(await outbox.deadLetters()).toHaveLength(1);
  });

  it("retry() revives a dead-letter back to queued for an explicit re-send", async () => {
    const transport = scriptedTransport([
      { kind: "rejected", message: "transient bad input the user fixed" },
      { kind: "ok" },
    ]);
    const outbox = createOutbox({ store, transport });

    const entry = await outbox.enqueue(baseCmd);
    await outbox.flush(); // → dead
    expect(await outbox.deadLetters()).toHaveLength(1);

    await outbox.retry(entry.uuid); // user taps "retry" in the drawer
    const summary = await outbox.flush();

    expect(summary.sent).toBe(1);
    expect(await outbox.deadLetters()).toHaveLength(0);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it("dismiss() permanently removes a dead-letter the user gives up on", async () => {
    const transport = scriptedTransport([{ kind: "rejected", message: "bad" }]);
    const outbox = createOutbox({ store, transport });
    const entry = await outbox.enqueue(baseCmd);
    await outbox.flush();

    await outbox.dismiss(entry.uuid);
    expect(await outbox.deadLetters()).toHaveLength(0);
    expect(await outbox.list()).toHaveLength(0);
  });

  it("notifies subscribers when the queue changes (for the sync pill)", async () => {
    const transport = scriptedTransport([{ kind: "ok" }]);
    const outbox = createOutbox({ store, transport });
    const onChange = vi.fn();
    const unsub = outbox.subscribe(onChange);

    await outbox.enqueue(baseCmd);
    expect(onChange).toHaveBeenCalled();

    onChange.mockClear();
    await outbox.flush();
    expect(onChange).toHaveBeenCalled();

    unsub();
    onChange.mockClear();
    await outbox.enqueue(baseCmd);
    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * Concurrency invariants (P2 review fixes #150 / #69 / #151). The outbox is a
   * singleton over a single store, drained both by the initial `start()` drain
   * and by every `online` window event. A connectivity flap during a slow send
   * overlaps two flushes; an operator action (dismiss/retry) can land inside a
   * send's await window. The slice promises exactly-once replay AND "never
   * silently lost / never blindly retried" — both must hold across overlap, not
   * only for strictly-sequential flushes.
   *
   * A "gated" transport parks each send on a promise the test resolves by hand,
   * so we can deterministically interleave a second flush / a dismiss / a retry
   * inside the suspension point between `transport.send()` and the status write.
   */
  function gatedTransport(): CommandTransport & {
    calls: { rpc: string; idempotencyKey: string }[];
    /** Resolve the i-th (0-based) parked send with the given result. */
    release(i: number, result?: TransportResult): void;
    /**
     * Resolve every send — current AND any issued later (e.g. a buggy second
     * send) — with `result`, so a test asserts cleanly instead of timing out on
     * an unreleased extra send the bug produced.
     */
    releaseAll(result?: TransportResult): void;
    /** Promise that resolves once the i-th send has been entered. */
    entered(i: number): Promise<void>;
  } {
    const calls: { rpc: string; idempotencyKey: string }[] = [];
    const gates: ((r: TransportResult) => void)[] = [];
    const enteredResolvers: (() => void)[] = [];
    const enteredPromises: Promise<void>[] = [];
    let autoRelease: TransportResult | null = null;
    const ensureEntered = (i: number) => {
      while (enteredPromises.length <= i) {
        let resolve!: () => void;
        enteredPromises.push(
          new Promise<void>((r) => {
            resolve = r;
          }),
        );
        enteredResolvers.push(resolve);
      }
    };
    return {
      calls,
      release(i, result = { kind: "ok" }) {
        gates[i]?.(result);
      },
      releaseAll(result = { kind: "ok" }) {
        autoRelease = result;
        for (const g of gates) g(result);
      },
      entered(i) {
        ensureEntered(i);
        return enteredPromises[i];
      },
      async send(cmd) {
        const i = calls.length;
        calls.push({ rpc: cmd.rpc, idempotencyKey: cmd.idempotencyKey });
        ensureEntered(i);
        enteredResolvers[i]();
        return new Promise<TransportResult>((resolve) => {
          if (autoRelease) resolve(autoRelease);
          else gates[i] = resolve;
        });
      },
    };
  }

  it("coalesces overlapping flushes — a single queued entry is sent exactly once (#150/#69)", async () => {
    // The double-send race: flush() snapshots `queued`, awaits send, only flips
    // status AFTER the await. A second flush during that window re-reads the
    // same `queued` entry and sends it AGAIN. The client must hold once-ness
    // itself, not lean on the server's idempotency-key dedupe.
    const transport = gatedTransport();
    const outbox = createOutbox({ store, transport });
    await outbox.enqueue(baseCmd);

    const firstFlush = outbox.flush();
    await transport.entered(0); // the first send is parked mid-flight.

    const secondFlush = outbox.flush(); // overlapping drain (online flap).
    // Let any microtasks in the second flush run before we release the first —
    // on the unguarded code this is where the second flush re-reads the still
    // `queued` entry and enters a SECOND transport.send().
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Release the first send AND any (buggy) second send that was issued, so the
    // test asserts cleanly instead of timing out on the parked second send.
    transport.releaseAll({ kind: "ok" });
    await Promise.all([firstFlush, secondFlush]);

    // exactly ONE transport send for the single queued entry.
    expect(transport.calls).toHaveLength(1);
    expect(await outbox.pendingCount()).toBe(0);
    const entries = await outbox.list();
    expect(entries[0].status).toBe("done");
  });

  it("does NOT resurrect an entry dismissed mid-send — the dismiss wins (#151)", async () => {
    // A still-queued entry is mid-send on slow signal; the operator dismisses it
    // (the row is deleted). When the send resolves ok, flush() must NOT write
    // the stale snapshot back — that would resurrect the dismissed command.
    const transport = gatedTransport();
    const outbox = createOutbox({ store, transport });
    const entry = await outbox.enqueue(baseCmd);

    const flushing = outbox.flush();
    await transport.entered(0); // send is parked; status not yet flipped.

    await outbox.dismiss(entry.uuid); // operator gives up — row deleted.

    transport.release(0, { kind: "ok" }); // slow send finally lands.
    await flushing;

    // the dismissed entry stays gone — not re-`put` as done.
    expect(await outbox.list()).toHaveLength(0);
    expect(await outbox.deadLetters()).toHaveLength(0);
  });

  it("does NOT re-queue an entry dismissed mid-send on a network error (#151)", async () => {
    // Symmetric clobber via the network-error branch: dismiss lands mid-send,
    // the send then fails on the network; the stale snapshot must NOT be written
    // back as `queued` — otherwise the dismissed command re-sends forever.
    const transport = gatedTransport();
    const outbox = createOutbox({ store, transport });
    const entry = await outbox.enqueue(baseCmd);

    const flushing = outbox.flush();
    await transport.entered(0);

    await outbox.dismiss(entry.uuid);

    transport.release(0, { kind: "network-error", message: "offline" });
    await flushing;

    expect(await outbox.list()).toHaveLength(0);
    expect(await outbox.pendingCount()).toBe(0);
  });
});
