import { describe, expect, it, vi } from "vitest";

import {
  makeServerActionTransport,
  type CommandEnvelope,
} from "@/lib/offline/transport";
import type { OutboxEntry } from "@/lib/offline/outbox";

/**
 * The transport bridges the outbox to a Server Action. It must classify the
 * action's result into the THREE outcomes the outbox branches on — and the
 * network/business distinction is the load-bearing one:
 *   - the action resolves "ok"          → ok (done)
 *   - the action resolves a rejection    → rejected (dead-letter)
 *   - the action THROWS (fetch failed / offline / 5xx) → network-error (requeue)
 */

const entry: OutboxEntry = {
  rpc: "record_weigh_in",
  args: { p_kg: 12.4 },
  occurredAt: "2026-06-21T17:00:00.000Z",
  deviceId: "dev-1",
  uuid: "0190aa00-0000-7000-8000-000000000000",
  idempotencyKey: "0190aa00-0000-7000-8000-000000000000",
  deviceSeq: 1,
  status: "queued",
  attempts: 0,
  enqueuedAt: "2026-06-21T17:00:00.000Z",
};

describe("makeServerActionTransport", () => {
  it("maps a successful action result to ok", async () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    const t = makeServerActionTransport(action);
    expect(await t.send(entry)).toEqual({ kind: "ok" });
    // the action received the full command envelope (rpc + ids + args).
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        rpc: "record_weigh_in",
        idempotencyKey: entry.idempotencyKey,
        deviceId: "dev-1",
        deviceSeq: 1,
      }),
    );
  });

  it("maps a business rejection to rejected (dead-letter)", async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      message: "reposo gate: not rest-stable",
    }));
    const t = makeServerActionTransport(action);
    const r = await t.send(entry);
    expect(r.kind).toBe("rejected");
    expect(r.kind === "rejected" && r.message).toMatch(/reposo gate/);
  });

  it("maps a THROWN action (network/offline) to network-error (requeue)", async () => {
    const action = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const t = makeServerActionTransport(action);
    const r = await t.send(entry);
    expect(r.kind).toBe("network-error");
    expect(r.kind === "network-error" && r.message).toMatch(/fetch/i);
  });

  /**
   * device_seq integrity (P2-S2): the capture surface bakes a PLACEHOLDER
   * `p_device_seq` (the client cannot mint the durable, monotonic, per-device
   * counter — only the outbox can). The transport MUST overwrite that placeholder
   * with the outbox-stamped `entry.deviceSeq`/`entry.deviceId` before the action
   * runs, or every capture on a screen mount carries the same `p_device_seq` and
   * collides on weigh_event's `unique (device_id, device_seq)`. The envelope's
   * top-level fields were already correct; the bug is that `args` was forwarded
   * verbatim, so the RPC (which reads `args.p_device_seq`) saw the stale 0.
   */
  it("injects the outbox-stamped device_seq/device_id into args, overwriting the client placeholder", async () => {
    const action = vi.fn(async (_env: CommandEnvelope) => ({ ok: true as const }));
    const t = makeServerActionTransport(action);
    // The client baked a placeholder seq of 0 (and a stale device id) into args.
    await t.send({
      ...entry,
      deviceSeq: 7,
      deviceId: "weigh-mount-abc",
      args: { p_kg: 12.4, p_device_seq: 0, p_device_id: "stale" },
    });
    expect(action).toHaveBeenCalledTimes(1);
    const env = action.mock.calls[0][0];
    // The DURABLE minted identity reaches the RPC args, not the client placeholder.
    expect(env.args.p_device_seq).toBe(7);
    expect(env.args.p_device_id).toBe("weigh-mount-abc");
    // Other args are preserved untouched.
    expect(env.args.p_kg).toBe(12.4);
    // The top-level envelope identity stays consistent with the injected args.
    expect(env.deviceSeq).toBe(7);
    expect(env.deviceId).toBe("weigh-mount-abc");
  });
});
