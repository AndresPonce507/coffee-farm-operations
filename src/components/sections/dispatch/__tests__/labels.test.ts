import { describe, expect, it } from "vitest";

import {
  type BilingualLabel,
  DISPATCH_TERMS,
  RIPENESS_LABELS,
  bilingual,
  speaksNgabere,
} from "@/components/sections/dispatch/labels";

describe("speaksNgabere", () => {
  it("is true when the languages array names ngäbere (with umlaut)", () => {
    expect(speaksNgabere(["ngäbere"])).toBe(true);
  });

  it("is true for the ascii spelling 'ngabere' and is case-insensitive", () => {
    expect(speaksNgabere(["NGABERE"])).toBe(true);
    expect(speaksNgabere(["es", "Ngäbere"])).toBe(true);
  });

  it("is false when only Spanish is listed", () => {
    expect(speaksNgabere(["es"])).toBe(false);
  });

  it("is false for an empty array", () => {
    expect(speaksNgabere([])).toBe(false);
  });
});

describe("bilingual", () => {
  const term: BilingualLabel = { es: "maduro", ng: "ngäbere-maduro" };

  it("returns Spanish only when the crew does not speak ngäbere", () => {
    expect(bilingual(term, ["es"], "fallback")).toBe("maduro");
  });

  it('returns "es · ngäbere" when the crew speaks ngäbere', () => {
    expect(bilingual(term, ["es", "ngäbere"], "fallback")).toBe(
      "maduro · ngäbere-maduro",
    );
  });

  it("returns the fallback when the label is undefined", () => {
    expect(bilingual(undefined, ["ngäbere"], "fallback")).toBe("fallback");
  });
});

describe("DISPATCH_TERMS", () => {
  it("exposes the core card terms, each with es + ng", () => {
    for (const key of [
      "goodMorning",
      "pickToday",
      "plots",
      "ripe",
      "pasada",
      "noPlots",
    ] as const) {
      const label = DISPATCH_TERMS[key];
      expect(typeof label.es).toBe("string");
      expect(label.es.length).toBeGreaterThan(0);
      expect(typeof label.ng).toBe("string");
      expect(label.ng.length).toBeGreaterThan(0);
    }
  });

  it("uses the expected Spanish copy for the headline terms", () => {
    expect(DISPATCH_TERMS.goodMorning.es).toBe("Buenos días");
    expect(DISPATCH_TERMS.pickToday.es).toBe("A cosechar hoy");
    expect(DISPATCH_TERMS.plots.es).toBe("parcelas");
    expect(DISPATCH_TERMS.ripe.es).toBe("maduro");
    expect(DISPATCH_TERMS.pasada.es).toBe("pasada");
  });
});

describe("RIPENESS_LABELS", () => {
  it("covers every RipenessTarget band with es + ng", () => {
    for (const band of ["low", "medium", "high"] as const) {
      const label = RIPENESS_LABELS[band];
      expect(typeof label.es).toBe("string");
      expect(label.es.length).toBeGreaterThan(0);
      expect(typeof label.ng).toBe("string");
      expect(label.ng.length).toBeGreaterThan(0);
    }
  });
});
