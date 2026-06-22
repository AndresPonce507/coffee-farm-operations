import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_LABELS,
  type BilingualLabel,
  EVENT_KIND_LABELS,
  TERMS,
  bilingual,
  speaksNgabere,
} from "@/components/sections/crew/labels";

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
  const term: BilingualLabel = { es: "presente", ng: "nügai" };

  it("returns Spanish only when the crew does not speak ngäbere", () => {
    expect(bilingual(term, ["es"], "fallback")).toBe("presente");
  });

  it('returns "es · ngäbere" when the crew speaks ngäbere', () => {
    expect(bilingual(term, ["es", "ngäbere"], "fallback")).toBe(
      "presente · nügai",
    );
  });

  it("returns the fallback when the label is undefined", () => {
    expect(bilingual(undefined, ["ngäbere"], "fallback")).toBe("fallback");
  });
});

describe("EVENT_KIND_LABELS", () => {
  it("renders the clock-out timeline term as a clean single-space 'salida · neme sribire'", () => {
    // Regression: the ngäbere value carried a stray leading space, so the
    // worker-profile-sheet attendance timeline rendered a double space
    // ("salida ·  neme sribire") for an ngäbere-speaking member.
    expect(
      bilingual(EVENT_KIND_LABELS["clock-out"], ["es", "ngäbere"], "clock-out"),
    ).toBe("salida · neme sribire");
  });

  it("never emits a leading/trailing/double space when rendering bilingual", () => {
    for (const label of Object.values(EVENT_KIND_LABELS)) {
      const rendered = bilingual(label, ["es", "ngäbere"], "fallback");
      expect(rendered).toBe(rendered.trim());
      expect(rendered).not.toMatch(/\s{2,}/);
    }
  });
});

describe("ngäbere label hygiene", () => {
  it("has no leading/trailing whitespace on any es or ng value", () => {
    const maps: Record<string, BilingualLabel>[] = [
      ATTENDANCE_LABELS,
      EVENT_KIND_LABELS,
      TERMS,
    ];
    for (const map of maps) {
      for (const label of Object.values(map)) {
        expect(label.es).toBe(label.es.trim());
        expect(label.ng).toBe(label.ng.trim());
      }
    }
  });
});
