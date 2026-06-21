import { describe, expect, it } from "vitest";

import {
  confidenceLabel,
  readinessLabel,
  readinessTone,
} from "@/components/sections/planning/readiness";

// Pure presentation logic for the planner — color tone + human label from a
// derived readiness score / confidence. Tested as logic (full red→green).

describe("readinessTone — maps a [0,1] readiness score to a glass tone", () => {
  it("is 'ready' (forest) at/above the ripe threshold", () => {
    expect(readinessTone(0.95)).toBe("ready");
    expect(readinessTone(0.85)).toBe("ready");
  });

  it("is 'approaching' (honey) in the mid band", () => {
    expect(readinessTone(0.6)).toBe("approaching");
  });

  it("is 'early' (sky) low on the scale", () => {
    expect(readinessTone(0.1)).toBe("early");
  });

  it("clamps out-of-range inputs (never throws on a bad number)", () => {
    expect(readinessTone(1.4)).toBe("ready");
    expect(readinessTone(-0.2)).toBe("early");
  });
});

describe("readinessLabel — a human-readable readiness phrase", () => {
  it("reads as a pick-cue near the top", () => {
    expect(readinessLabel(0.9).toLowerCase()).toMatch(/ready|pick/);
  });
  it("reads as 'approaching' / 'soon' in the middle", () => {
    expect(readinessLabel(0.6).toLowerCase()).toMatch(/approach|soon|days/);
  });
  it("reads as 'early' / 'developing' at the bottom", () => {
    expect(readinessLabel(0.1).toLowerCase()).toMatch(/early|developing|weeks/);
  });
});

describe("confidenceLabel — honest confidence note (never hidden)", () => {
  it("explains a low-confidence prediction rather than hiding it", () => {
    expect(confidenceLabel("low").toLowerCase()).toMatch(/estimat|gdd|low/);
  });
  it("labels high confidence", () => {
    expect(confidenceLabel("high").toLowerCase()).toMatch(/high|confiden/);
  });
});
