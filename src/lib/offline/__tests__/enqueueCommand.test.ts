import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "@/lib/offline/storage";
import {
  createOutbox,
  type CommandTransport,
  type TransportResult,
} from "@/lib/offline/outbox";
import { makeEnqueueCommand } from "@/lib/offline/enqueueCommand";

/**
 * `enqueueCommand()` is the ONE call every later field-capture slice
 * (S2 weigh, S1 attendance, S3/S4 readings, S12 scouting) uses instead of the
 * raw Server Action. It is the graceful-degradation seam:
 *   - offline-enabled: the command is queued (durable) and replayed later — the
 *     caller gets an immediate "queued" acknowledgement, the picker walks away.
 *   - offline-disabled (flag off / no IndexedDB): it falls through to the direct
 *     transport, so online-only still works exactly as before.
 */
describe("enqueueCommand", () => {
  let store = createMemoryStore();

  beforeEach(() => {
    store = createMemoryStore();
  });

  const cmd = {
    rpc: "record_weigh_in",
    args: { p_kg: 12.4 },
    occurredAt: "2026-06-21T17:00:00.000Z",
    deviceId: "dev-1",
  };

  it("when offline-first is ENABLED: queues the command and returns 'queued'", async () => {
    const transport: CommandTransport = {
      send: vi.fn(async (): Promise<TransportResult> => ({ kind: "ok" })),
    };
    const outbox = createOutbox({ store, transport });
    const enqueueCommand = makeEnqueueCommand({ outbox, offlineEnabled: true });

    const res = await enqueueCommand(cmd);

    expect(res.outcome).toBe("queued");
    expect(res.uuid).toMatch(/^[0-9a-f-]{36}$/);
    // it does NOT eagerly send — flush() does that when connectivity allows.
    expect(transport.send).not.toHaveBeenCalled();
    expect(await outbox.pendingCount()).toBe(1);
  });

  it("when offline-first is DISABLED: sends directly and returns 'sent'", async () => {
    const transport: CommandTransport = {
      send: vi.fn(async (): Promise<TransportResult> => ({ kind: "ok" })),
    };
    const outbox = createOutbox({ store, transport });
    const enqueueCommand = makeEnqueueCommand({ outbox, offlineEnabled: false });

    const res = await enqueueCommand(cmd);

    expect(res.outcome).toBe("sent");
    expect(transport.send).toHaveBeenCalledTimes(1);
    // nothing left durably queued — it went straight through.
    expect(await outbox.pendingCount()).toBe(0);
  });

  it("disabled + a business rejection surfaces synchronously (no silent queue)", async () => {
    const transport: CommandTransport = {
      send: vi.fn(
        async (): Promise<TransportResult> => ({
          kind: "rejected",
          message: "oversell",
        }),
      ),
    };
    const outbox = createOutbox({ store, transport });
    const enqueueCommand = makeEnqueueCommand({ outbox, offlineEnabled: false });

    const res = await enqueueCommand(cmd);
    expect(res.outcome).toBe("rejected");
    expect(res.message).toMatch(/oversell/);
  });

  it("mints the idempotency key once so a direct retry de-dupes server-side", async () => {
    const sent: string[] = [];
    const transport: CommandTransport = {
      send: vi.fn(async (c) => {
        sent.push(c.idempotencyKey);
        return { kind: "ok" } as const;
      }),
    };
    const outbox = createOutbox({ store, transport });
    const enqueueCommand = makeEnqueueCommand({ outbox, offlineEnabled: false });

    const res = await enqueueCommand({ ...cmd, idempotencyKey: "stable-key-1" });
    expect(res.outcome).toBe("sent");
    expect(sent).toEqual(["stable-key-1"]);
  });
});
