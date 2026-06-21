import { describe, expect, it, vi } from "vitest";

import { makeServerActionTransport } from "@/lib/offline/transport";
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
});
