import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)`. Mock a single rpc
// spy whose result each test sets. next-intl/server is mocked globally in setup.ts, so
// getTranslations resolves the real EN copy — validation messages come back as the
// actual English strings the UI shows. record/revise are owner-authored evidence
// writes (NOT money-shaped, NOT untrusted-inbound-driven), so there is no inventory
// ripple — the island calls router.refresh(); these actions bust nothing.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));

import {
  recordAccoladeAction,
  reviseAccoladeAction,
} from "@/app/(app)/reputation/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const awardInput = () => ({
  lotCode: "JC-901",
  kind: "award" as const,
  title: "Best of Panama 2025",
  score: null,
  awardedBy: "SCAP",
  awardYear: 2025,
  evidenceUrl: "https://example.org/bop",
  sourceSessionId: null,
  idempotencyKey: "idem-a1",
});

describe("recordAccoladeAction — validation seam", () => {
  it("rejects a missing lot WITHOUT touching the database", async () => {
    const r = await recordAccoladeAction({ ...awardInput(), lotCode: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick a lot to credit.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range cup score WITHOUT touching the database", async () => {
    const r = await recordAccoladeAction({
      ...awardInput(),
      kind: "cup-score",
      title: null,
      score: 120,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("A cup score must be between 0 and 100.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an award with no title WITHOUT touching the database", async () => {
    const r = await recordAccoladeAction({ ...awardInput(), title: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Give the accolade a title.");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("recordAccoladeAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to record_accolade on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const r = await recordAccoladeAction(awardInput());
    expect(r).toEqual({ ok: true, accoladeId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("record_accolade", {
      p_lot_code: "JC-901",
      p_kind: "award",
      p_title: "Best of Panama 2025",
      p_score: null,
      p_awarded_by: "SCAP",
      p_award_year: 2025,
      p_evidence_url: "https://example.org/bop",
      p_source_session_id: null,
      p_idempotency_key: "idem-a1",
    });
  });

  it("surfaces the author-written guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard = "a cup-score accolade must carry a score in [0,100] (got 120)";
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: guard, code: "23514" },
    });
    const r = await recordAccoladeAction({
      ...awardInput(),
      kind: "cup-score",
      title: null,
      score: 95,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(guard);
      expect(r.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy (no raw leak)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "lot_accolades" does not exist', code: "42P01" },
    });
    const r = await recordAccoladeAction(awardInput());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(
        "Could not record that accolade. Check the entry and try again.",
      );
      expect(r.error).not.toMatch(/relation|lot_accolades/);
    }
  });
});

describe("reviseAccoladeAction — the correction path", () => {
  it("rejects an out-of-range new score WITHOUT touching the database", async () => {
    const r = await reviseAccoladeAction({
      accoladeId: 1,
      newScore: 200,
      note: "typo",
      idempotencyKey: "idem-r1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("A cup score must be between 0 and 100.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive accolade id WITHOUT touching the database", async () => {
    const r = await reviseAccoladeAction({
      accoladeId: 0,
      newScore: 90,
      note: null,
      idempotencyKey: "idem-r0",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick the cup score to revise.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to revise_accolade and returns the revision id", async () => {
    rpcMock.mockResolvedValue({ data: 77, error: null });
    const r = await reviseAccoladeAction({
      accoladeId: 1,
      newScore: 90.5,
      note: "re-cupped",
      idempotencyKey: "idem-r2",
    });
    expect(r).toEqual({ ok: true, accoladeId: 77 });
    expect(rpcMock).toHaveBeenCalledWith("revise_accolade", {
      p_accolade_id: 1,
      p_new_score: 90.5,
      p_note: "re-cupped",
      p_idempotency_key: "idem-r2",
    });
  });
});
