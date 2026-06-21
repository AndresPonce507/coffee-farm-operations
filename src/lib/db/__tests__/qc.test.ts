import { describe, expect, it } from "vitest";

import {
  mapCupFinalScore,
  mapCupperDrift,
  mapCuppingSession,
  mapGreenDefect,
  mapQcStatus,
  type CupFinalScoreRow,
  type CupperDriftRow,
  type CuppingSessionRow,
  type GreenDefectRow,
  type QcStatusRow,
} from "@/lib/db/qc";

/**
 * Pure-mapper test for the QC read port (P2-S6). PostgREST serializes numerics as
 * strings and leaves nullable sums null; the mappers coerce to the camelCase domain
 * shapes the QC UI consumes. No DB — just row → domain, mirroring the greenlots.ts
 * mapper-test idiom. The live SQL behavior is proven in s6_qc_cupping.db.test.ts.
 */

describe("mapQcStatus — the per-lot QC roll-up", () => {
  it("coerces the held flag, hold reason, latest score, and defect tallies", () => {
    const row: QcStatusRow = {
      green_lot_code: "JC-9001",
      held: true,
      hold_reason: "off-flavor — re-cup",
      latest_cup_score: "88.5",
      primary_defects: "2",
      secondary_defects: "5",
    };
    expect(mapQcStatus(row)).toEqual({
      greenLotCode: "JC-9001",
      held: true,
      holdReason: "off-flavor — re-cup",
      latestCupScore: 88.5,
      primaryDefects: 2,
      secondaryDefects: 5,
    });
  });

  it("maps a clean lot — not held, no reason, no score yet", () => {
    const row: QcStatusRow = {
      green_lot_code: "JC-9002",
      held: false,
      hold_reason: null,
      latest_cup_score: null,
      primary_defects: "0",
      secondary_defects: "0",
    };
    const out = mapQcStatus(row);
    expect(out.held).toBe(false);
    expect(out.holdReason).toBeNull();
    expect(out.latestCupScore).toBeNull(); // never fabricated as 0
    expect(out.primaryDefects).toBe(0);
  });
});

describe("mapCupFinalScore — the derived session total", () => {
  it("coerces the additive final score and attribute count", () => {
    const row: CupFinalScoreRow = {
      session_id: 7,
      green_lot_code: "JC-9001",
      cupper_id: "w-cup-1",
      protocol: "sca-cva",
      is_calibration: false,
      final_score: "62",
      attribute_count: "8",
    };
    expect(mapCupFinalScore(row)).toEqual({
      sessionId: 7,
      greenLotCode: "JC-9001",
      cupperId: "w-cup-1",
      protocol: "sca-cva",
      isCalibration: false,
      finalScore: 62,
      attributeCount: 8,
    });
  });
});

describe("mapCupperDrift — the calibration bias evidence", () => {
  it("coerces the signed drift and the panel/cupper means", () => {
    const row: CupperDriftRow = {
      cupper_id: "w-cup-2",
      attribute: "acidity",
      cupper_mean: "10",
      panel_mean: "8",
      drift: "2",
      sample_n: "1",
    };
    expect(mapCupperDrift(row)).toEqual({
      cupperId: "w-cup-2",
      attribute: "acidity",
      cupperMean: 10,
      panelMean: 8,
      drift: 2,
      sampleN: 1,
    });
  });

  it("preserves a negative drift sign (a cupper scoring below the panel)", () => {
    const row: CupperDriftRow = {
      cupper_id: "w-cup-1",
      attribute: "acidity",
      cupper_mean: "7",
      panel_mean: "8",
      drift: "-1",
      sample_n: "1",
    };
    expect(mapCupperDrift(row).drift).toBeCloseTo(-1, 6);
  });
});

describe("mapCuppingSession + mapGreenDefect", () => {
  it("maps a session row to its camelCase domain shape", () => {
    const row: CuppingSessionRow = {
      id: 3,
      green_lot_code: "JC-9001",
      cupper_id: "w-cup-1",
      protocol: "legacy-100",
      is_calibration: true,
      occurred_at: "2026-06-21T10:00:00.000Z",
    };
    expect(mapCuppingSession(row)).toEqual({
      id: 3,
      greenLotCode: "JC-9001",
      cupperId: "w-cup-1",
      protocol: "legacy-100",
      isCalibration: true,
      occurredAt: "2026-06-21T10:00:00.000Z",
    });
  });

  it("maps a defect row, coercing the count", () => {
    const row: GreenDefectRow = {
      id: 11,
      green_lot_code: "JC-9001",
      defect_kind: "full-black",
      count: "2",
      category: "primary",
    };
    expect(mapGreenDefect(row)).toEqual({
      id: 11,
      greenLotCode: "JC-9001",
      defectKind: "full-black",
      count: 2,
      category: "primary",
    });
  });
});
