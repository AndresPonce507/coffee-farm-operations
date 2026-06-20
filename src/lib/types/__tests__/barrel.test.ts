/**
 * Structural smoke for the S3 spine domain types.
 *
 * These types are pure compile-time contracts (TypeScript erases them at runtime),
 * so this suite asserts that the spine types are *importable* from the canonical
 * "@/lib/types" barrel — and that an existing type (Plot) still is — by exercising
 * each shape as a typed value. If the barrel ever stops exporting one of these,
 * `import type { ... }` fails to type-check and the build goes red; constructing a
 * conforming value here gives the suite a runtime assertion to anchor on too.
 */
import { describe, expect, it } from "vitest";

import type {
  LotEdge,
  LotEvent,
  LotGenealogy,
  LotNode,
  Plot,
  Unit,
} from "@/lib/types";

describe("@/lib/types barrel — S3 spine types", () => {
  it("exports LotEvent with the event-log column contract", () => {
    const ev: LotEvent = {
      id: "11111111-1111-1111-1111-111111111111",
      streamKey: "JC-700",
      kind: "cherry_intake",
      occurredAt: "2026-06-20T12:00:00.000Z",
      recordedAt: "2026-06-20T12:00:01.000Z",
      deviceId: "device-A",
      deviceSeq: 1,
      payload: { lot_code: "JC-700", cherries_kg: 120 },
    };
    expect(ev.streamKey).toBe("JC-700");
    expect(ev.payload.lot_code).toBe("JC-700");
    // chainVerified is optional — a value without it still conforms.
    expect(ev.chainVerified).toBeUndefined();

    const verified: LotEvent = { ...ev, chainVerified: true };
    expect(verified.chainVerified).toBe(true);
  });

  it("exports LotNode mirroring the promoted lots graph-node columns", () => {
    const node: LotNode = {
      code: "JC-700",
      stage: "cherry",
      variety: "Geisha",
      originKg: 120,
      currentKg: 120,
      isSingleOrigin: true,
      mintedAt: "2026-06-20T12:00:00.000Z",
    };
    expect(node.code).toBe("JC-700");
    expect(node.isSingleOrigin).toBe(true);
  });

  it("exports LotEdge whose kind matches the lot_edges check constraint", () => {
    const kinds: LotEdge["kind"][] = ["split", "merge", "blend", "process"];
    const edge: LotEdge = {
      parentCode: "JC-700",
      childCode: "JC-701",
      kind: "split",
      kg: 60,
    };
    expect(kinds).toContain(edge.kind);
    expect(edge.kg).toBeGreaterThan(0);
  });

  it("exports LotGenealogy as a {nodes, edges} graph", () => {
    const graph: LotGenealogy = {
      nodes: [
        {
          code: "JC-700",
          stage: "cherry",
          variety: "Geisha",
          originKg: 120,
          currentKg: 60,
          isSingleOrigin: true,
          mintedAt: "2026-06-20T12:00:00.000Z",
        },
      ],
      edges: [
        { parentCode: "JC-700", childCode: "JC-701", kind: "split", kg: 60 },
      ],
    };
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges[0].parentCode).toBe(graph.nodes[0].code);
  });

  it("exports Unit mirroring the units table convert_qty implies", () => {
    const kg: Unit = {
      code: "kg",
      dimension: "mass",
      toBase: 1,
      display: "kg",
    };
    expect(kg.code).toBe("kg");
    expect(kg.dimension).toBe("mass");
    expect(kg.toBase).toBe(1);
  });

  it("still exports an existing type (Plot) verbatim", () => {
    const plot: Plot = {
      id: "p1",
      name: "Tizingal Alto",
      block: "Block A",
      variety: "Geisha",
      areaHa: 1.2,
      altitudeMasl: 1650,
      trees: 3200,
      shadePct: 40,
      establishedYear: 2015,
      status: "healthy",
      lastInspected: "2026-06-19",
      expectedYieldKg: 9000,
      harvestedKg: 4200,
    };
    expect(plot.name).toBe("Tizingal Alto");
  });
});
