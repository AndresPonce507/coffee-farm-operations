import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "@/lib/offline/storage";
import {
  createOutbox,
  type CommandTransport,
  type TransportResult,
} from "@/lib/offline/outbox";
import { makeEnqueueCommand } from "@/lib/offline/enqueueCommand";
import {
  validateWeighIn,
  weighInRpcArgs,
} from "@/lib/db/commands/recordWeighIn";

/**
 * P2-S2 weigh-in OVER THE S0 OFFLINE OUTBOX — the genesis field event must be
 * captured at 1,700 masl with no signal and replayed exactly-once on reconnect. This
 * test wires the REAL S0 outbox + enqueueCommand to the weigh-in's REAL RPC envelope
 * (weighInRpcArgs), with the network MOCKED via a scripted transport, and pins:
 *
 *   - OFFLINE: a weigh-in queues (no eager send) and the picker gets an immediate
 *     "queued" — the tap never blocks on signal.
 *   - RECONNECT: flush() drains it through the transport once → "done".
 *   - EXACTLY-ONCE: a second flush of the SAME entry never re-sends (the
 *     idempotency_key the RPC dedupes on is stable across the replay).
 *   - NETWORK FAILURE stays queued (no loss); a BUSINESS rejection (e.g. the
 *     active-crew gate) dead-letters (surfaced, never silently dropped) — the two
 *     paths must NOT be confused.
 */

/** A scripted transport: each send pops the next result; records what it saw. */
function scriptedTransport(
  results: TransportResult[],
): CommandTransport & {
  calls: { rpc: string; idempotencyKey: string; kg: unknown }[];
} {
  const calls: { rpc: string; idempotencyKey: string; kg: unknown }[] = [];
  let i = 0;
  return {
    calls,
    async send(entry) {
      calls.push({
        rpc: entry.rpc,
        idempotencyKey: entry.idempotencyKey,
        kg: (entry.args as Record<string, unknown>).p_cherries_kg,
      });
      return results[i++] ?? { kind: "ok" };
    },
  };
}

/** Build the weigh command envelope a field surface would enqueue. */
function weighCmd(overrides: Record<string, unknown> = {}) {
  const parsed = validateWeighIn({
    workerId: "w-lucia",
    plotId: "p-tizingal-alto",
    cherriesKg: "12.4",
    ripeness: "ripe",
    scaleSource: "manual",
    capturedLat: "8.777835",
    capturedLng: "-82.640344",
    occurredAt: "2026-06-21T17:00:00.000Z",
    deviceId: "dev-field-1",
    deviceSeq: "0", // the outbox re-stamps device_seq; key is what dedupes
    idempotencyKey: "weigh-key-1",
    ...overrides,
  });
  if (!parsed.ok) throw new Error("fixture should validate");
  return {
    rpc: "record_weigh_in",
    args: weighInRpcArgs(parsed.data),
    occurredAt: parsed.data.occurredAt,
    deviceId: parsed.data.deviceId,
    idempotencyKey: parsed.data.idempotencyKey,
  };
}

describe("weigh-in over the offline outbox", () => {
  let store = createMemoryStore();
  beforeEach(() => {
    store = createMemoryStore();
  });

  it("OFFLINE: queues the weigh-in (no eager send) and returns 'queued'", async () => {
    const transport = scriptedTransport([{ kind: "ok" }]);
    const outbox = createOutbox({ store, transport });
    const enqueue = makeEnqueueCommand({ outbox, offlineEnabled: true });

    const res = await enqueue(weighCmd());

    expect(res.outcome).toBe("queued");
    expect(transport.calls).toHaveLength(0); // the tap did NOT block on signal
    expect(await outbox.pendingCount()).toBe(1);
  });

  it("RECONNECT + EXACTLY-ONCE: flush sends once; a second flush never re-sends", async () => {
    const transport = scriptedTransport([{ kind: "ok" }]);
    const outbox = createOutbox({ store, transport });
    const enqueue = makeEnqueueCommand({ outbox, offlineEnabled: true });

    await enqueue(weighCmd());
    const first = await outbox.flush();
    expect(first.sent).toBe(1);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].rpc).toBe("record_weigh_in");
    expect(transport.calls[0].idempotencyKey).toBe("weigh-key-1");
    expect(transport.calls[0].kg).toBe(12.4);

    // the picker walks back into signal a second time / the engine re-flushes:
    const second = await outbox.flush();
    expect(second.sent).toBe(0); // already done — exactly-once, no duplicate send
    expect(transport.calls).toHaveLength(1);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it("NETWORK FAILURE stays queued (no loss); BUSINESS rejection dead-letters", async () => {
    // first send: network error → stays queued; retry: business reject → dead-letter.
    const transport = scriptedTransport([
      { kind: "network-error", message: "offline" },
      { kind: "rejected", message: "worker is not an active crew member" },
    ]);
    const outbox = createOutbox({ store, transport });
    const enqueue = makeEnqueueCommand({ outbox, offlineEnabled: true });

    await enqueue(weighCmd());

    const f1 = await outbox.flush();
    expect(f1.failed).toBe(1);
    expect(f1.deadLettered).toBe(0);
    expect(await outbox.pendingCount()).toBe(1); // STILL queued — no silent loss

    const f2 = await outbox.flush();
    expect(f2.deadLettered).toBe(1);
    const dead = await outbox.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0].lastError).toMatch(/active crew member/);
    expect(await outbox.pendingCount()).toBe(0); // moved out of the live queue
  });
});
