import { describe, expect, it, vi } from "vitest";

import {
  createRoastProfile,
  validateCreateRoastProfile,
  friendlyCreateRoastProfileError,
  ROAST_LEVELS,
  ROAST_VARIETIES,
  type CreateRoastProfileStore,
} from "@/lib/db/commands/createRoastProfile";

/**
 * Pure-domain command test for authoring a DRAFT roast profile (P3-S10 — roasting;
 * ADR-002 — every write flows through a SECURITY DEFINER command RPC). No database:
 * the command runs against a *fake store* stubbing `.rpc('create_roast_profile', …)`,
 * proving (a) the friendly-validation seam (the roast_level / coffee_variety enums +
 * the `> 0` temp/time CHECKs, the 0–100 DTR), (b) the exact snake_case envelope, and
 * (c) that the profile-id is returned / coerced. A re-author of the same name mints
 * the next version in the DB (pinned by the migration's PGlite tests, not here).
 * Mirrors the recordGreenGrade.test.ts idiom.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateRoastProfileStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateRoastProfileStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  name: "Janson House Filter",
  variety: "Geisha",
  roastLevel: "medium-light",
  targetChargeTempC: "200",
  targetDropTempC: "205",
  targetTotalTimeS: "600",
  targetDtrPct: "22",
  idempotencyKey: "idem-profile-1",
});

// ─────────────────────────── enum catalogues ───────────────────────────────

describe("roast enum catalogues", () => {
  it("exposes the on-disk roast_level enum verbatim", () => {
    expect([...ROAST_LEVELS]).toEqual([
      "light",
      "medium-light",
      "medium",
      "medium-dark",
      "dark",
    ]);
  });

  it("exposes the coffee_variety enum verbatim", () => {
    expect([...ROAST_VARIETIES]).toEqual([
      "Geisha",
      "Caturra",
      "Catuaí",
      "Pacamara",
      "Typica",
    ]);
  });
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateCreateRoastProfile", () => {
  it("accepts a complete, well-formed profile", () => {
    const r = validateCreateRoastProfile(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe("Janson House Filter");
      expect(r.data.variety).toBe("Geisha");
      expect(r.data.roastLevel).toBe("medium-light");
      expect(r.data.targetChargeTempC).toBe(200);
      expect(r.data.targetDropTempC).toBe(205);
      expect(r.data.targetTotalTimeS).toBe(600);
      expect(r.data.targetDtrPct).toBe(22);
      expect(r.data.idempotencyKey).toBe("idem-profile-1");
    }
  });

  it("treats a blank variety as null (a house style may span varieties)", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), variety: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.variety).toBeNull();
  });

  it("treats a blank DTR as null", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), targetDtrPct: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.targetDtrPct).toBeNull();
  });

  it("rejects a missing name", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeDefined();
  });

  it("rejects an unknown roast level (the roast_level enum)", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), roastLevel: "charcoal" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.roastLevel).toBeDefined();
  });

  it("rejects a missing roast level", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), roastLevel: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.roastLevel).toBeDefined();
  });

  it("rejects an unknown variety (the coffee_variety enum)", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), variety: "Bourbon" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.variety).toBeDefined();
  });

  it("rejects a non-positive charge temp (the > 0 CHECK)", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), targetChargeTempC: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.targetChargeTempC).toMatch(/greater than 0/i);
  });

  it("rejects a non-positive drop temp", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), targetDropTempC: "-3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.targetDropTempC).toBeDefined();
  });

  it("rejects a non-positive total time", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), targetTotalTimeS: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.targetTotalTimeS).toBeDefined();
  });

  it("rejects a DTR outside 0–100", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), targetDtrPct: "120" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.targetDtrPct).toMatch(/0.*100/);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateCreateRoastProfile({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyCreateRoastProfileError", () => {
  it("translates an invalid enum cast into a plain sentence (no errcode)", () => {
    const msg = friendlyCreateRoastProfileError({
      code: "22P02",
      message: 'invalid input value for enum roast_level: "charcoal"',
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/roast level|variety/i);
    expect(msg).not.toMatch(/22P02|roast_level/);
  });

  it("falls back to a clean generic line for anything unrecognised", () => {
    const msg = friendlyCreateRoastProfileError({ message: "deadlock detected" });
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/deadlock detected/);
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("createRoastProfile", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createRoastProfile(store, { ...validRaw(), roastLevel: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_roast_profile once with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const result = await createRoastProfile(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_roast_profile", {
      p_name: "Janson House Filter",
      p_variety: "Geisha",
      p_roast_level: "medium-light",
      p_target_charge_temp_c: 200,
      p_target_drop_temp_c: 205,
      p_target_total_time_s: 600,
      p_target_dtr_pct: 22,
      p_idempotency_key: "idem-profile-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profileId).toBe(7);
  });

  it("forwards a blank variety / DTR as null in the envelope", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    await createRoastProfile(store, { ...validRaw(), variety: "", targetDtrPct: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_variety).toBeNull();
    expect(args.p_target_dtr_pct).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await createRoastProfile(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profileId).toBe(9);
  });

  it("surfaces an RPC failure as a friendly message (no raw PG text)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "22P02", message: 'invalid input value for enum roast_level: "x"' },
    });
    const result = await createRoastProfile(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/22P02|roast_level/);
    }
  });

  it("returns a clean message when the RPC yields no id", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await createRoastProfile(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
