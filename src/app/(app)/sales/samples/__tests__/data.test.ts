import { describe, expect, it } from "vitest";

import {
  isReserveBand,
  mapSamplePipelineRow,
  trackingUrl,
  type SampleViewRow,
} from "@/app/(app)/sales/samples/data";

/**
 * Pure read-port logic for P3-S2 sample tracking: the v_sample_pipeline row mapper
 * (PostgREST may serialize numerics as strings), the reserve-band visual hint, and
 * the $0 public-tracker deep-link builder (NO carrier API — rail paid-gate §221).
 */

const viewRow = (over: Partial<SampleViewRow> = {}): SampleViewRow => ({
  sample_id: 1,
  green_lot_code: "JC-204",
  buyer_id: 7,
  buyer_name: "Tokyo Roasters",
  sample_kind: "pre_shipment",
  grams: "200",
  courier: "DHL",
  tracking_no: "JD0001",
  dispatched_at: "2026-06-20T12:00:00Z",
  sca_grade: "Presidential",
  cupping_score: "91.5",
  ...over,
});

describe("mapSamplePipelineRow — view row → camelCase, numeric coercion", () => {
  it("coerces string numerics and carries every field", () => {
    expect(mapSamplePipelineRow(viewRow())).toEqual({
      sampleId: 1,
      greenLotCode: "JC-204",
      buyerId: 7,
      buyerName: "Tokyo Roasters",
      sampleKind: "pre_shipment",
      grams: 200,
      courier: "DHL",
      trackingNo: "JD0001",
      dispatchedAt: "2026-06-20T12:00:00Z",
      scaGrade: "Presidential",
      cuppingScore: 91.5,
    });
  });

  it("preserves a null buyer / score / courier / tracking (never fabricates)", () => {
    const r = mapSamplePipelineRow(
      viewRow({
        buyer_id: null,
        buyer_name: null,
        courier: null,
        tracking_no: null,
        cupping_score: null,
      }),
    );
    expect(r.buyerId).toBeNull();
    expect(r.buyerName).toBeNull();
    expect(r.courier).toBeNull();
    expect(r.trackingNo).toBeNull();
    expect(r.cuppingScore).toBeNull();
  });
});

describe("isReserveBand — the reserve-band visual hint", () => {
  it("flags Presidential and Specialty (the reserve-mandatory band)", () => {
    expect(isReserveBand("Presidential")).toBe(true);
    expect(isReserveBand("Specialty")).toBe(true);
  });

  it("does not flag a commodity grade or an ungraded lot", () => {
    expect(isReserveBand("Premium")).toBe(false);
    expect(isReserveBand("Below Specialty")).toBe(false);
    expect(isReserveBand(null)).toBe(false);
  });
});

describe("trackingUrl — $0 public-tracker deep link (no carrier API)", () => {
  it("returns null when there is no tracking number", () => {
    expect(trackingUrl("DHL", null)).toBeNull();
    expect(trackingUrl("DHL", "   ")).toBeNull();
  });

  it("builds carrier deep links for DHL / FedEx / UPS", () => {
    expect(trackingUrl("DHL Express", "JD123")).toContain("dhl.com");
    expect(trackingUrl("FedEx", "FX9")).toContain("fedex.com");
    expect(trackingUrl("UPS", "1Z9")).toContain("ups.com");
  });

  it("url-encodes the tracking number into the link", () => {
    expect(trackingUrl("DHL", "A B/C")).toContain("A%20B%2FC");
  });

  it("falls back to a generic search for an unknown courier ($0, no API)", () => {
    const u = trackingUrl("Estafeta", "X1");
    expect(u).not.toBeNull();
    expect(u).toContain("X1");
  });
});
