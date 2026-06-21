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
});
