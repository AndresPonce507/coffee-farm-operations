import { describe, expect, it, vi } from "vitest";

import {
  lockRoastProfile,
  validateLockRoastProfile,
  friendlyLockRoastProfileError,
  type LockRoastProfileStore,
} from "@/lib/db/commands/lockRoastProfile";

/**
 * Pure-domain command test for the ONE-WAY golden lock (P3-S10 — roasting; ADR-002).
 * The `lock_roast_profile` RPC transitions a profile draft→approved(golden), which is
 * MONOTONIC: the status guard physically rejects any backward move, so a re-tune is a
 * NEW version, never a mutation. This file proves the friendly-validation seam, the
 * exact snake_case envelope, and — the LOAD-BEARING one — that the "only a draft can be
 * locked golden" rejection surfaces as a CLEAN sentence (raw PG text never leaks). The
 * one-way enforcement itself is the migration's job, pinned by its PGlite tests.
 */

interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: LockRoastProfileStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as LockRoastProfileStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  profileId: "7",
  idempotencyKey: "idem-lock-7",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateLockRoastProfile", () => {
  it("accepts a well-formed lock request", () => {
    const r = validateLockRoastProfile(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.profileId).toBe(7);
      expect(r.data.idempotencyKey).toBe("idem-lock-7");
    }
  });

  it("rejects a non-positive profile id", () => {
    const r = validateLockRoastProfile({ ...validRaw(), profileId: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.profileId).toBeDefined();
  });

  it("rejects a non-integer profile id (the bigint identity)", () => {
    const r = validateLockRoastProfile({ ...validRaw(), profileId: "7.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.profileId).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateLockRoastProfile({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyLockRoastProfileError", () => {
  it("translates the one-way lock rejection (not a draft) into a plain sentence", () => {
    const msg = friendlyLockRoastProfileError({
      code: "23514",
      message:
        "roast profile 7 is retired — only a draft can be locked golden (versioning is one-way)",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/draft|golden|version/i);
    expect(msg).not.toMatch(/23514|roast_profiles/);
  });

  it("translates an unknown profile into a plain sentence", () => {
    const msg = friendlyLockRoastProfileError({
      code: "23503",
      message: "unknown roast profile 99",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/couldn't be found|profile/i);
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(friendlyLockRoastProfileError({ message: "deadlock detected" })).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("lockRoastProfile", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await lockRoastProfile(store, { ...validRaw(), profileId: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls lock_roast_profile with the exact envelope and returns the golden status", async () => {
    const { store, rpc } = fakeStore({ data: "approved", error: null });
    const result = await lockRoastProfile(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("lock_roast_profile", {
      p_profile_id: 7,
      p_idempotency_key: "idem-lock-7",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("approved");
  });

  it("surfaces the one-way lock rejection as a friendly message (no raw PG text)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "roast profile 7 is retired — only a draft can be locked golden (versioning is one-way)",
      },
    });
    const result = await lockRoastProfile(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/draft|golden|version/i);
      expect(result.message).not.toMatch(/23514|roast_profiles/);
    }
  });

  it("surfaces an unknown profile as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown roast profile 99" },
    });
    const result = await lockRoastProfile(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/couldn't be found|profile/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await lockRoastProfile(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/deadlock detected/);
    }
  });
});
