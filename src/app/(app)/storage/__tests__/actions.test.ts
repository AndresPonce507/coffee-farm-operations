import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)`. Mock a single rpc
// spy whose result each test sets. next-intl/server is mocked globally in setup.ts, so
// getTranslations resolves the real EN copy — validation messages come back as the
// actual English strings the UI shows. None of these are inventory-shaped, so there is
// no ripple — the island calls router.refresh(); the actions bust nothing.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));

import {
  issueStorageCertificateAction,
  recordStorageReadingAction,
  upsertStorageLocationAction,
} from "@/app/(app)/storage/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const readingInput = () => ({
  locationCode: "BOD-1",
  tempC: 21,
  rhPct: 58,
  aw: 0.61,
  source: "manual" as const,
  deviceId: null,
  readingAt: "2026-06-20T12:00:00Z",
  idempotencyKey: "idem-r1",
});

describe("recordStorageReadingAction — validation seam", () => {
  it("rejects a missing location WITHOUT touching the database", async () => {
    const r = await recordStorageReadingAction({ ...readingInput(), locationCode: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick a location first.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an empty reading (no temp, rh, or aw) WITHOUT touching the database", async () => {
    const r = await recordStorageReadingAction({
      ...readingInput(),
      tempC: null,
      rhPct: null,
      aw: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/temperature, humidity, or water activity/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("recordStorageReadingAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to record_storage_reading", async () => {
    rpcMock.mockResolvedValue({ data: 12, error: null });
    const r = await recordStorageReadingAction(readingInput());
    expect(r).toEqual({ ok: true, readingId: 12 });
    expect(rpcMock).toHaveBeenCalledWith("record_storage_reading", {
      p_location_code: "BOD-1",
      p_temp_c: 21,
      p_rh_pct: 58,
      p_aw: 0.61,
      p_source: "manual",
      p_device_id: null,
      p_reading_at: "2026-06-20T12:00:00Z",
      p_idempotency_key: "idem-r1",
    });
  });

  it("coerces a string id from PostgREST to a number", async () => {
    rpcMock.mockResolvedValue({ data: "9", error: null });
    const r = await recordStorageReadingAction(readingInput());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.readingId).toBe(9);
  });
});

describe("issueStorageCertificateAction — the evidence gate", () => {
  const certInput = () => ({
    greenLotCode: "JC-901",
    locationCode: "BOD-1",
    windowStart: "2026-06-01T00:00:00Z",
    windowEnd: "2026-06-20T00:00:00Z",
    idempotencyKey: "idem-c1",
  });

  it("rejects a backwards window WITHOUT touching the database", async () => {
    const r = await issueStorageCertificateAction({
      ...certInput(),
      windowStart: "2026-06-20T00:00:00Z",
      windowEnd: "2026-06-01T00:00:00Z",
    });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to issue_storage_certificate on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 55, error: null });
    const r = await issueStorageCertificateAction(certInput());
    expect(r).toEqual({ ok: true, certificateId: 55 });
    expect(rpcMock).toHaveBeenCalledWith("issue_storage_certificate", {
      p_green_lot_code: "JC-901",
      p_location_code: "BOD-1",
      p_window_start: "2026-06-01T00:00:00Z",
      p_window_end: "2026-06-20T00:00:00Z",
      p_idempotency_key: "idem-c1",
    });
  });

  it("surfaces the author-written zero-readings refusal verbatim (never a fabricated in-band)", async () => {
    const guard =
      "cannot issue a storage certificate for lot JC-901 over [2026-06-01, 2026-06-20): zero readings — verdict can only be insufficient-data, never a fabricated in-band";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const r = await issueStorageCertificateAction(certInput());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(guard);
      expect(r.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy (no raw leak)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "storage_certificates" does not exist', code: "42P01" },
    });
    const r = await issueStorageCertificateAction(certInput());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Could not save that. Check the numbers and try again.");
      expect(r.error).not.toMatch(/relation|storage_certificates/);
    }
  });
});

describe("upsertStorageLocationAction — validation seam", () => {
  const locInput = () => ({
    code: "BOD-1",
    name: "Bodega central",
    tempMinC: 15,
    tempMaxC: 25,
    rhMinPct: 50,
    rhMaxPct: 65,
    awMax: 0.65,
    idempotencyKey: "idem-l1",
  });

  it("rejects a band whose minimum is above its maximum WITHOUT touching the database", async () => {
    const r = await upsertStorageLocationAction({ ...locInput(), tempMinC: 30, tempMaxC: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/minimum can't be above the maximum/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a water activity outside 0..1 WITHOUT touching the database", async () => {
    const r = await upsertStorageLocationAction({ ...locInput(), awMax: 1.4 });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to upsert_storage_location on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const r = await upsertStorageLocationAction(locInput());
    expect(r).toEqual({ ok: true, locationId: 3 });
    expect(rpcMock).toHaveBeenCalledWith("upsert_storage_location", {
      p_code: "BOD-1",
      p_name: "Bodega central",
      p_temp_min_c: 15,
      p_temp_max_c: 25,
      p_rh_min_pct: 50,
      p_rh_max_pct: 65,
      p_aw_max: 0.65,
      p_idempotency_key: "idem-l1",
    });
  });
});
