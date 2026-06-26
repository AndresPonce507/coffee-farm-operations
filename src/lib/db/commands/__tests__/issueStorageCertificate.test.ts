import { describe, expect, it, vi } from "vitest";

import {
  issueStorageCertificate,
  validateIssueStorageCertificate,
  type IssueStorageCertificateStore,
} from "@/lib/db/commands/issueStorageCertificate";

/**
 * Pure-domain command test for the storage-certificate writer (P3-S20 — the EUDR
 * honest-provenance posture, here for controlled-environment storage; ADR-002).
 * Drives the command against a fake `.rpc('issue_storage_certificate', …)` store and
 * proves: (a) the friendly-validation seam (lot + location + idempotency required;
 * a valid window with end > start), (b) the exact snake_case envelope, and — the
 * LOAD-BEARING case — (c) the EVIDENCE GATE: when the RPC RAISES because the window
 * has zero readings, the command surfaces a CLEAN "no readings" message (never a
 * fabricated 'in-band'; the verdict can only be 'insufficient-data'). The window
 * read + cert_hash + the readings_count=0 refusal are the RPC's job (PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: IssueStorageCertificateStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as IssueStorageCertificateStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-701",
  locationCode: "BODEGA-A",
  windowStart: "2026-06-01T00:00:00.000Z",
  windowEnd: "2026-06-21T00:00:00.000Z",
  idempotencyKey: "idem-cert-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateIssueStorageCertificate", () => {
  it("accepts a complete, well-formed certificate request", () => {
    const r = validateIssueStorageCertificate(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-701");
      expect(r.data.locationCode).toBe("BODEGA-A");
      expect(r.data.windowStart).toBe("2026-06-01T00:00:00.000Z");
      expect(r.data.windowEnd).toBe("2026-06-21T00:00:00.000Z");
      expect(r.data.idempotencyKey).toBe("idem-cert-1");
    }
  });

  it("rejects a missing green lot", () => {
    const r = validateIssueStorageCertificate({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("rejects a missing location", () => {
    const r = validateIssueStorageCertificate({ ...validRaw(), locationCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.locationCode).toBeDefined();
  });

  it("rejects a missing / malformed window bound", () => {
    const noStart = validateIssueStorageCertificate({ ...validRaw(), windowStart: "" });
    expect(noStart.ok).toBe(false);

    const badEnd = validateIssueStorageCertificate({ ...validRaw(), windowEnd: "nope" });
    expect(badEnd.ok).toBe(false);
  });

  it("rejects a window whose end is not after its start", () => {
    const r = validateIssueStorageCertificate({
      ...validRaw(),
      windowStart: "2026-06-21T00:00:00.000Z",
      windowEnd: "2026-06-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.windowEnd).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateIssueStorageCertificate({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("issueStorageCertificate", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await issueStorageCertificate(store, {
      ...validRaw(),
      greenLotCode: "",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls issue_storage_certificate with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 9, error: null });
    const result = await issueStorageCertificate(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("issue_storage_certificate", {
      p_green_lot_code: "JC-701",
      p_location_code: "BODEGA-A",
      p_window_start: "2026-06-01T00:00:00.000Z",
      p_window_end: "2026-06-21T00:00:00.000Z",
      p_idempotency_key: "idem-cert-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.certificateId).toBe(9);
  });

  it("surfaces the EVIDENCE GATE (zero readings) as a friendly no-readings message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "cannot issue a storage certificate for lot JC-701 over [2026-06-01, 2026-06-21): zero readings — verdict can only be insufficient-data, never a fabricated in-band",
      },
    });
    const result = await issueStorageCertificate(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/reading|evidence|insufficient/i);
      expect(result.message).not.toMatch(/check_violation|errcode/);
    }
  });

  it("surfaces an unknown lot / location as a friendly not-found message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown green lot JC-999 for tenant" },
    });
    const result = await issueStorageCertificate(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/lot|location|found/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await issueStorageCertificate(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
