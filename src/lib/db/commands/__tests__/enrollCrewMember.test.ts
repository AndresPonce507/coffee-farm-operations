import { describe, expect, it, vi } from "vitest";

import {
  enrollCrewMember,
  validateCrewEnrollment,
  type CrewEnrollmentStore,
} from "@/lib/db/commands/enrollCrewMember";

/**
 * Pure-domain command test for the crew-enrollment write (ADR-002 — every write
 * flows through a SECURITY DEFINER command RPC). This file does NOT touch a
 * database: it drives the command against a *fake store* (a hand-rolled stub of
 * the one method the command calls, `.rpc('enroll_crew_member', …)`), proving
 * the friendly-validation seam and the exactly-once contract SHAPE.
 */

/** Build a fake CrewEnrollmentStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: string | null; error: { message: string } | null },
): { store: CrewEnrollmentStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CrewEnrollmentStore, rpc };
}

/** A complete, valid raw enrollment — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  workerId: "w-lucia",
  crewId: "crew-pickers-a",
  occurredAt: "2026-06-20T14:03:00.000Z",
  deviceId: "server",
  deviceSeq: "1",
  idempotencyKey: "enroll-2026-06-20-w-lucia-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateCrewEnrollment", () => {
  it("accepts a complete, well-formed enrollment", () => {
    const r = validateCrewEnrollment(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.workerId).toBe("w-lucia");
      expect(r.data.crewId).toBe("crew-pickers-a");
      expect(r.data.deviceSeq).toBe(1);
    }
  });

  it("rejects a missing worker with a friendly error", () => {
    const r = validateCrewEnrollment({ ...validRaw(), workerId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.workerId).toMatch(/worker/i);
  });

  it("rejects a missing crew with a friendly error", () => {
    const r = validateCrewEnrollment({ ...validRaw(), crewId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.crewId).toMatch(/crew/i);
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateCrewEnrollment({ ...validRaw(), occurredAt: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("rejects a missing device id", () => {
    const r = validateCrewEnrollment({ ...validRaw(), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.deviceId).toBeDefined();
  });

  it("rejects a negative / non-integer device sequence", () => {
    expect(validateCrewEnrollment({ ...validRaw(), deviceSeq: "-1" }).ok).toBe(false);
    expect(validateCrewEnrollment({ ...validRaw(), deviceSeq: "1.5" }).ok).toBe(false);
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validateCrewEnrollment({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateCrewEnrollment({ ...validRaw(), workerId: "", crewId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["crewId", "workerId"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("enrollCrewMember", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await enrollCrewMember(store, { ...validRaw(), crewId: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.crewId).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls enroll_crew_member EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: "evt-uuid-456", error: null });

    const result = await enrollCrewMember(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("enroll_crew_member", {
      p_worker_id: "w-lucia",
      p_crew_id: "crew-pickers-a",
      p_occurred_at: "2026-06-20T14:03:00.000Z",
      p_device_id: "server",
      p_device_seq: 1,
      p_idempotency_key: "enroll-2026-06-20-w-lucia-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventUid).toBe("evt-uuid-456");
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });

    const result = await enrollCrewMember(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("enroll_crew_member");
      expect(result.message).toContain("duplicate key");
    }
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: "evt-uuid-456", error: null });
    const raw = validRaw();

    const first = await enrollCrewMember(store, raw);
    const second = await enrollCrewMember(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
