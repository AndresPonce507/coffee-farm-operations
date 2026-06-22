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
 *   - DEVICE_SEQ COLLISION-PROOF (the slice's load-bearing invariant): TWO
 *     DISTINCT offline weigh-ins from one device-mount must reach the server
 *     under DISTINCT, strictly-increasing `device_seq` values, so the genesis
 *     `unique (device_id, device_seq)` ledger key never collides and no lata is
 *     silently dead-lettered on reconnect. The capture surface hardcodes the raw
 *     args `p_device_seq` to 0 (a placeholder); the COLLISION-PROOFING rides on
 *     the outbox-minted monotonic `deviceSeq` the transport layer re-stamps into
 *     `p_device_seq` on replay — NOT on the queued args. This file pins that the
 *     mint is per-enqueue and monotonic; a regression to a constant seq (which
 *     would dead-letter latas 2..N of a picker's line) turns this test red.
 */

/**
 * A scripted transport: each send pops the next result; records what it saw —
 * including BOTH the outbox-minted `deviceSeq` (the collision-proof causal key the
 * real transport layer forwards as `device_seq`) and the raw queued
 * `args.p_device_seq` (the capture-surface placeholder), so the suite can prove
 * the two are NOT the same value and that the minted one is what must be distinct.
 */
function scriptedTransport(
  results: TransportResult[],
): CommandTransport & {
  calls: {
    rpc: string;
    idempotencyKey: string;
    kg: unknown;
    deviceSeq: number;
    argsDeviceSeq: unknown;
  }[];
} {
  const calls: {
    rpc: string;
    idempotencyKey: string;
    kg: unknown;
    deviceSeq: number;
    argsDeviceSeq: unknown;
  }[] = [];
  let i = 0;
  return {
    calls,
    async send(entry) {
      calls.push({
        rpc: entry.rpc,
        idempotencyKey: entry.idempotencyKey,
        kg: (entry.args as Record<string, unknown>).p_cherries_kg,
        // The outbox-minted monotonic causal key — what the real transport layer
        // (transport.ts / runtime.ts) re-stamps into the RPC's `p_device_seq`.
        deviceSeq: entry.deviceSeq,
        // The raw queued placeholder the capture surface enqueued (hardcoded 0).
        argsDeviceSeq: (entry.args as Record<string, unknown>).p_device_seq,
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
    // The capture surface hardcodes the raw args `p_device_seq` to 0 — a
    // PLACEHOLDER. The real collision-proof key is the outbox-minted monotonic
    // `deviceSeq` (stamped per-enqueue: 1, 2, 3…), which the transport layer
    // re-stamps into the RPC's `p_device_seq` on replay. The idempotency_key is
    // the exactly-once anchor; `device_seq` is the causal-ordering / unique key.
    deviceSeq: "0",
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

  // ── THE "device_seq collision-proof" invariant — the genesis ledger's load-
  // bearing guarantee, previously WHOLLY UNTESTED. A supervisor captures a
  // picker's whole line offline from ONE screen-mount: N DISTINCT weigh-ins
  // (N distinct idempotency_keys) under the SAME device_id, each enqueued with
  // the placeholder `p_device_seq: 0`. On reconnect they must reach the server
  // under DISTINCT, strictly-increasing `device_seq` — otherwise latas 2..N each
  // collide on `unique (device_id, device_seq)`, come back as a business
  // rejection, and get DEAD-LETTERED: the picker is paid for 1 lata and the lot
  // mass is short the rest. The collision-proofing rides on the outbox-minted
  // monotonic `deviceSeq` (what the real transport layer re-stamps into
  // `p_device_seq`), NOT on the queued args (which stay 0). The old suite never
  // enqueued two distinct weigh-ins, so it could not see this; this case does.
  it("COLLISION-PROOF: two DISTINCT offline weigh-ins get DISTINCT, increasing device_seq (never 0,0)", async () => {
    const transport = scriptedTransport([{ kind: "ok" }, { kind: "ok" }]);
    const outbox = createOutbox({ store, transport });
    const enqueue = makeEnqueueCommand({ outbox, offlineEnabled: true });

    // Lucía's first two latas: two distinct keys, ONE device_id (one mount).
    await enqueue(
      weighCmd({ idempotencyKey: "weigh-lata-1", cherriesKg: "8.0" }),
    );
    await enqueue(
      weighCmd({ idempotencyKey: "weigh-lata-2", cherriesKg: "9.0" }),
    );
    expect(await outbox.pendingCount()).toBe(2);

    // Reconnect: both drain through the transport.
    const summary = await outbox.flush();
    expect(summary.sent).toBe(2);
    expect(summary.deadLettered).toBe(0); // neither lata is lost
    expect(transport.calls).toHaveLength(2);

    // Both rode the SAME device_id (one screen-mount) but distinct keys.
    expect(transport.calls.map((c) => c.idempotencyKey)).toEqual([
      "weigh-lata-1",
      "weigh-lata-2",
    ]);
    expect(transport.calls.map((c) => c.kg)).toEqual([8.0, 9.0]);

    // THE invariant: the collision-proof `device_seq` the transport receives is
    // DISTINCT and STRICTLY INCREASING — never the constant 0 the args carry.
    const seqs = transport.calls.map((c) => c.deviceSeq);
    expect(new Set(seqs).size).toBe(2); // distinct → no (device_id, seq) collision
    expect(seqs[1]).toBeGreaterThan(seqs[0]); // monotonic
    expect(seqs.every((s) => Number.isInteger(s) && s >= 1)).toBe(true);

    // And the guarantee does NOT come from the queued args: the capture surface
    // hardcodes `p_device_seq` to 0, so BOTH entries carry args 0 (the stale
    // placeholder). If a future change ever leaned on args.p_device_seq for the
    // unique key, it would collide on (device_id, 0) — this pins that it doesn't.
    expect(transport.calls.map((c) => c.argsDeviceSeq)).toEqual([0, 0]);
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
