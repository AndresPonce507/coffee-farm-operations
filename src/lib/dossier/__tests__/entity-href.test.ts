import { describe, expect, it } from "vitest";

import {
  DOSSIER_KINDS,
  entityHref,
  type DossierKind,
} from "@/lib/dossier/entity-href";

/**
 * entityHref is THE single source of truth for entity → dossier URLs (ARCHITECTURE
 * §7 C1, build-plan §3 RESOLVED). The Map's imperative `router.push`, the ⌘K palette,
 * and every `<EntityLink>` all read it — so its shape is a frozen contract. db-free
 * pure-map unit coverage of all 7 dossier kinds, id encoding, and #anchor appension.
 */
describe("entityHref", () => {
  it("covers all 8 dossier kinds and nothing else", () => {
    expect(Object.keys(entityHref).sort()).toEqual(
      [...DOSSIER_KINDS].sort(),
    );
    expect(DOSSIER_KINDS).toHaveLength(8);
  });

  // The exact route shapes that facet-02 §3.1 / ARCHITECTURE §3.1 pin. A route
  // rename must touch THIS map and break THIS test — never silently diverge.
  it.each<[DossierKind, string, string]>([
    ["lot", "JC-712", "/lots/JC-712"],
    ["plot", "p1", "/plots/p1"],
    ["worker", "w42", "/workers/w42"],
    ["crew", "c3", "/crew/c3"],
    ["batch", "B-09", "/ferment/B-09"],
    ["dispatch", "17", "/dispatch/17"],
    ["pay-period", "2026-W12", "/pay-period/2026-W12"],
    ["drying-station", "st-1", "/drying-station/st-1"],
  ])("maps %s id %s → %s", (kind, id, expected) => {
    expect(entityHref[kind](id)).toBe(expected);
  });

  it("encodes ids so a slash or space can't break the path", () => {
    expect(entityHref.lot("JC 7/12")).toBe("/lots/JC%207%2F12");
    expect(entityHref.plot("a b")).toBe("/plots/a%20b");
  });

  it("appends a #anchor for DRILL deep-links and encodes it", () => {
    expect(entityHref.lot("JC-712", { anchor: "cost-entries" })).toBe(
      "/lots/JC-712#cost-entries",
    );
    expect(entityHref.plot("p1", { anchor: "satellite" })).toBe(
      "/plots/p1#satellite",
    );
  });

  it("omits the # when no anchor is given (and on an empty anchor)", () => {
    expect(entityHref.worker("w1")).toBe("/workers/w1");
    expect(entityHref.worker("w1", {})).toBe("/workers/w1");
    expect(entityHref.worker("w1", { anchor: "" })).toBe("/workers/w1");
  });

  it("coerces a numeric id to a string (dispatch run ids are numeric)", () => {
    // Callers pass `run.id` which may be a number off `v_dispatch_card.id`.
    expect(entityHref.dispatch(17 as unknown as string)).toBe("/dispatch/17");
  });
});
