import { describe, expect, it, vi } from "vitest";

import {
  recordAccolade,
  validateRecordAccolade,
  type RecordAccoladeStore,
} from "@/lib/db/commands/recordAccolade";

/**
 * Pure-domain command test for the P3-S19 reputation writer (`record_accolade`).
 * Drives the command against a fake `.rpc('record_accolade', …)` store and proves
 * the friendly-validation seam (the DB CHECK + FK + append-only invariants, mirrored
 * so the form fails fast), the exact snake_case `p_` argument envelope, and clean
 * error surfacing. The keystone guards (cup-score-needs-a-score CHECK, unknown-lot
 * FK, score-revision-only-via-revise, the append-only triggers) are the REAL
 * enforcement (the migration's PGlite tests in s19_reputation.db.test.ts); this proves
 * the row never reaches the RPC malformed. Mirrors recordAuctionComp.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordAccoladeStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordAccoladeStore, rpc };
}

/** The BoP-winning Geisha's 89.5 cup score — the canonical cup-score accolade. */
const validCupScore = (): Record<string, unknown> => ({
  lotCode: "JC-701",
  kind: "cup-score",
  title: null,
  score: "89.5",
  awardedBy: "Janson QC lab",
  awardYear: "2025",
  evidenceUrl: "https://example.org/cupping.pdf",
  sourceSessionId: null,
  idempotencyKey: "idem-acc-1",
});

/** An award accolade — title carries the meaning, no score. */
const validAward = (): Record<string, unknown> => ({
  lotCode: "JC-701",
  kind: "award",
  title: "Best of Panama — Champion Lot",
  awardedBy: "SCAP",
  awardYear: "2025",
  idempotencyKey: "idem-acc-2",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordAccolade", () => {
  it("accepts a complete cup-score accolade", () => {
    const r = validateRecordAccolade(validCupScore());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.lotCode).toBe("JC-701");
      expect(r.data.kind).toBe("cup-score");
      expect(r.data.score).toBe(89.5);
      expect(r.data.awardYear).toBe(2025);
    }
  });

  it("accepts an award (title carries it; score forwarded null)", () => {
    const r = validateRecordAccolade(validAward());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.kind).toBe("award");
      expect(r.data.title).toBe("Best of Panama — Champion Lot");
      expect(r.data.score).toBeNull();
    }
  });

  it("rejects a missing lot code (the FK target)", () => {
    const r = validateRecordAccolade({ ...validCupScore(), lotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lotCode).toBeDefined();
  });

  it("rejects an unknown kind", () => {
    const r = validateRecordAccolade({ ...validCupScore(), kind: "trophy" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toBeDefined();
  });

  it("rejects 'score-revision' here (it flows only through revise_accolade)", () => {
    const r = validateRecordAccolade({
      ...validCupScore(),
      kind: "score-revision",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toMatch(/revis/i);
  });

  it("rejects a cup-score with no score (the cup_score CHECK)", () => {
    const r = validateRecordAccolade({ ...validCupScore(), score: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.score).toBeDefined();
  });

  it("rejects a cup-score outside [0,100] (the cup_score CHECK)", () => {
    const r = validateRecordAccolade({ ...validCupScore(), score: "101" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.score).toMatch(/0.*100/);
  });

  it("rejects a non-cup accolade with no title (meaningless without a name)", () => {
    const r = validateRecordAccolade({ ...validAward(), title: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.title).toBeDefined();
  });

  it("rejects a non-integer / out-of-range award year (the award_year CHECK)", () => {
    const bad = validateRecordAccolade({ ...validCupScore(), awardYear: "1899" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.awardYear).toBeDefined();
    const word = validateRecordAccolade({ ...validCupScore(), awardYear: "twenty" });
    expect(word.ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordAccolade({ ...validCupScore(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("forwards blank optional fields as null", () => {
    const r = validateRecordAccolade({
      lotCode: "JC-701",
      kind: "cup-score",
      score: "88",
      idempotencyKey: "idem-x",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.title).toBeNull();
      expect(r.data.awardedBy).toBeNull();
      expect(r.data.awardYear).toBeNull();
      expect(r.data.evidenceUrl).toBeNull();
      expect(r.data.sourceSessionId).toBeNull();
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordAccolade", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordAccolade(store, {
      ...validCupScore(),
      lotCode: "",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_accolade with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const result = await recordAccolade(store, validCupScore());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_accolade", {
      p_lot_code: "JC-701",
      p_kind: "cup-score",
      p_title: null,
      p_score: 89.5,
      p_awarded_by: "Janson QC lab",
      p_award_year: 2025,
      p_evidence_url: "https://example.org/cupping.pdf",
      p_source_session_id: null,
      p_idempotency_key: "idem-acc-1",
    });
    expect(result).toEqual({ ok: true, accoladeId: 7 });
  });

  it("forwards a null score for a non-cup accolade", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    await recordAccolade(store, validAward());
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_kind).toBe("award");
    expect(args.p_score).toBeNull();
    expect(args.p_title).toBe("Best of Panama — Champion Lot");
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await recordAccolade(store, validCupScore());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.accoladeId).toBe(9);
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown lot JC-999 for tenant", code: "23503" },
    });
    const result = await recordAccolade(store, validCupScore());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("unknown lot");
  });

  it("reports a try-again message when the RPC returns no id", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await recordAccolade(store, validCupScore());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/try again/i);
  });
});
