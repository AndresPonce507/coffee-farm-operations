import { describe, expect, it } from "vitest";

import {
  layoutGenealogy,
  NODE_W,
  NODE_H,
  COL_PITCH,
  ROW_PITCH,
} from "@/lib/ui/graph-layout";
import type { LotEdge, LotGenealogy, LotNode } from "@/lib/types";

/* ---------------- fixture helpers ---------------- */

function node(code: string, currentKg = 100, originKg = currentKg): LotNode {
  return {
    code,
    stage: "green",
    variety: "Caturra",
    originKg,
    currentKg,
    isSingleOrigin: true,
    mintedAt: "2026-06-20",
  };
}

function edge(
  parentCode: string,
  childCode: string,
  kg: number,
  kind: LotEdge["kind"] = "process",
): LotEdge {
  return { parentCode, childCode, kind, kg };
}

/**
 * The AD-1 HARD-GATE fixture: a split-then-blend graph.
 *
 *   A (cherry intake)
 *   ├─split→ W (Washed)
 *   └─split→ N (Natural)
 *   W ─process→ Wd (washed dried)
 *   N ─process→ Nd (natural dried)
 *   Wd ─blend→ G (final green)
 *   Nd ─blend→ G
 *
 * One source splits into two methods which later blend into one green lot.
 */
function splitThenBlend(): LotGenealogy {
  return {
    nodes: [
      node("A", 500),
      node("W", 250),
      node("N", 250),
      node("Wd", 40),
      node("Nd", 45),
      node("G", 85),
    ],
    edges: [
      edge("A", "W", 250, "split"),
      edge("A", "N", 250, "split"),
      edge("W", "Wd", 40),
      edge("N", "Nd", 45),
      edge("Wd", "G", 40, "blend"),
      edge("Nd", "G", 45, "blend"),
    ],
  };
}

/* ---------------- geometry helpers ---------------- */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  // Strict overlap of axis-aligned rectangles (touching edges is NOT overlap).
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

function segmentsCross(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  // Proper segment intersection via orientation tests; shared endpoints don't count.
  const o = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const o1 = o(p1, p2, p3);
  const o2 = o(p1, p2, p4);
  const o3 = o(p3, p4, p1);
  const o4 = o(p3, p4, p2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** Count crossings between edges using their endpoint segments (straight approximation). */
function countEdgeCrossings(
  edges: { from: { x: number; y: number }; to: { x: number; y: number } }[],
): number {
  let count = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (
        segmentsCross(edges[i].from, edges[i].to, edges[j].from, edges[j].to)
      ) {
        count++;
      }
    }
  }
  return count;
}

/* ====================================================================== */
/* AD-1 HARD GATE                                                          */
/* ====================================================================== */

describe("layoutGenealogy — AD-1 hard gate (split-then-blend)", () => {
  it("produces ZERO node-box overlaps", () => {
    const { nodes } = layoutGenealogy(splitThenBlend());
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        expect(
          rectsOverlap(a, b),
          `nodes ${a.code} and ${b.code} overlap`,
        ).toBe(false);
      }
    }
  });

  it("pins the pitch invariants the zero-overlap guarantee rests on", () => {
    // The no-overlap guarantee is NOT magic: it holds iff each column's pitch is
    // at least the box size on that axis. Pin those preconditions directly so a
    // future tuning (or a switch to a compaction pass) that violates them fails
    // here — converting the unconditional overlap assertion into a real guard.
    expect(ROW_PITCH).toBeGreaterThanOrEqual(NODE_H);
    expect(COL_PITCH).toBeGreaterThanOrEqual(NODE_W);
  });

  it("produces ZERO node-box overlaps across MANY randomized DAG shapes", () => {
    // A deterministic pseudo-random DAG generator: edges only ever point from a
    // lower-indexed node to a higher-indexed one (guarantees acyclicity), with
    // varied fan-out/fan-in so columns get genuinely crowded. This exercises a
    // code path that COULD overlap if placement regressed — unlike the single
    // hand-built fixture, whose shape the grid trivially satisfies.
    let seed = 0x9e3779b9;
    const rnd = () => {
      // xorshift32 — deterministic, no deps.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 1000) / 1000;
    };

    for (let trial = 0; trial < 40; trial++) {
      const n = 4 + Math.floor(rnd() * 14); // 4..17 nodes
      const nodes: LotNode[] = Array.from({ length: n }, (_, i) =>
        node(`N${i}`, 1 + Math.floor(rnd() * 900)),
      );
      const edges: LotEdge[] = [];
      for (let j = 1; j < n; j++) {
        // each node gets 1..3 parents drawn from strictly-lower indices
        const parentCount = 1 + Math.floor(rnd() * 3);
        const used = new Set<number>();
        for (let p = 0; p < parentCount; p++) {
          const parent = Math.floor(rnd() * j);
          if (used.has(parent)) continue;
          used.add(parent);
          edges.push(edge(`N${parent}`, `N${j}`, 1 + Math.floor(rnd() * 900)));
        }
      }

      const { nodes: laid } = layoutGenealogy({ nodes, edges });
      for (let i = 0; i < laid.length; i++) {
        for (let k = i + 1; k < laid.length; k++) {
          expect(
            rectsOverlap(laid[i], laid[k]),
            `trial ${trial}: ${laid[i].code} and ${laid[k].code} overlap`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps edge crossings within the known-good bound (0 for this fixture)", () => {
    const layout = layoutGenealogy(splitThenBlend());
    const byCode = new Map(layout.nodes.map((n) => [n.code, n]));
    const segs = layout.edges.map((e) => {
      const p = byCode.get(e.parentCode)!;
      const c = byCode.get(e.childCode)!;
      return {
        from: { x: p.x + p.w, y: p.y + p.h / 2 },
        to: { x: c.x, y: c.y + c.h / 2 },
      };
    });
    // The split-then-blend graph admits a planar (zero-crossing) layout.
    expect(countEdgeCrossings(segs)).toBeLessThanOrEqual(0);
  });
});

/* ====================================================================== */
/* Column invariant — longest-path layering                               */
/* ====================================================================== */

describe("layoutGenealogy — layering (column invariant)", () => {
  it("places every parent in a strictly smaller column than its children", () => {
    const layout = layoutGenealogy(splitThenBlend());
    const col = new Map(layout.nodes.map((n) => [n.code, n.column]));
    for (const e of layout.edges) {
      expect(
        col.get(e.parentCode)!,
        `${e.parentCode} (col ${col.get(e.parentCode)}) must be left of ${
          e.childCode
        } (col ${col.get(e.childCode)})`,
      ).toBeLessThan(col.get(e.childCode)!);
    }
  });

  it("uses LONGEST path (column = longest chain from a root), not shortest", () => {
    // A→B→C and A→C. Longest-path puts C at column 2 (via A→B→C),
    // not column 1 (the direct A→C edge).
    const g: LotGenealogy = {
      nodes: [node("A"), node("B"), node("C")],
      edges: [edge("A", "B", 10), edge("B", "C", 10), edge("A", "C", 5)],
    };
    const layout = layoutGenealogy(g);
    const col = new Map(layout.nodes.map((n) => [n.code, n.column]));
    expect(col.get("A")).toBe(0);
    expect(col.get("B")).toBe(1);
    expect(col.get("C")).toBe(2);
  });

  it("x increases with column (left-to-right time order)", () => {
    const layout = layoutGenealogy(splitThenBlend());
    const sorted = [...layout.nodes].sort((a, b) => a.column - b.column);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].column > sorted[i - 1].column) {
        expect(sorted[i].x).toBeGreaterThan(sorted[i - 1].x);
      }
    }
  });
});

/* ====================================================================== */
/* Ribbon width — clamp(2, k·√kg, 28), monotonic in kg                    */
/* ====================================================================== */

describe("layoutGenealogy — ribbon width", () => {
  it("clamps every stroke width within [2, 28]", () => {
    const g: LotGenealogy = {
      nodes: [node("A", 1000), node("tiny", 5), node("huge", 1000)],
      edges: [edge("A", "tiny", 5), edge("A", "huge", 1000)],
    };
    const layout = layoutGenealogy(g);
    for (const e of layout.edges) {
      expect(e.strokeWidth).toBeGreaterThanOrEqual(2);
      expect(e.strokeWidth).toBeLessThanOrEqual(28);
    }
  });

  it("a 5 kg sample does not vanish (>= 2px floor)", () => {
    const g: LotGenealogy = {
      nodes: [node("A"), node("B", 5)],
      edges: [edge("A", "B", 5)],
    };
    const layout = layoutGenealogy(g);
    expect(layout.edges[0].strokeWidth).toBeGreaterThanOrEqual(2);
  });

  it("a 1000 kg edge is capped at 28px (never swallows a node)", () => {
    const g: LotGenealogy = {
      nodes: [node("A", 1000), node("B", 1000)],
      edges: [edge("A", "B", 1000)],
    };
    const layout = layoutGenealogy(g);
    expect(layout.edges[0].strokeWidth).toBeLessThanOrEqual(28);
  });

  it("stroke width is monotonic non-decreasing in kg", () => {
    const kgs = [1, 5, 10, 50, 100, 200, 400, 800, 1600];
    const widths = kgs.map((kg) => {
      const g: LotGenealogy = {
        nodes: [node("A", 2000), node("B", kg)],
        edges: [edge("A", "B", kg)],
      };
      return layoutGenealogy(g).edges[0].strokeWidth;
    });
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
  });

  it("uses sqrt compression (a 4x mass increase is less than a 4x width increase only after clamp; unclamped mid-range is sqrt)", () => {
    // Pick masses safely inside the unclamped band so the sqrt law is observable.
    const wOf = (kg: number) => {
      const g: LotGenealogy = {
        nodes: [node("A", 5000), node("B", kg)],
        edges: [edge("A", "B", kg)],
      };
      return layoutGenealogy(g).edges[0].strokeWidth;
    };
    const w1 = wOf(64);
    const w2 = wOf(256); // 4x the mass
    // sqrt(256)/sqrt(64) = 2, so width roughly doubles, NOT quadruples.
    const ratio = w2 / w1;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(3);
  });
});

/* ====================================================================== */
/* Ribbon ordering at a node — sort by mass so ribbons nest, never braid  */
/* ====================================================================== */

describe("layoutGenealogy — ribbon ordering (nest, never braid)", () => {
  it("orders out-edges at a node by mass (deterministic nesting key)", () => {
    const g: LotGenealogy = {
      nodes: [node("A", 1000), node("s", 10), node("m", 100), node("l", 300)],
      edges: [
        edge("A", "m", 100),
        edge("A", "l", 300),
        edge("A", "s", 10),
      ],
    };
    const layout = layoutGenealogy(g);
    const outA = layout.edges
      .filter((e) => e.parentCode === "A")
      .map((e) => ({ child: e.childCode, order: e.parentSlot }));
    // parentSlot is the nesting rank at the source node; must be sorted by kg.
    const byOrder = [...outA].sort((a, b) => a.order - b.order);
    expect(byOrder.map((o) => o.child)).toEqual(["l", "m", "s"]);
  });
});

/* ====================================================================== */
/* Determinism — byte-identical output across runs                        */
/* ====================================================================== */

describe("layoutGenealogy — determinism", () => {
  it("produces byte-identical output across repeated runs", () => {
    const a = JSON.stringify(layoutGenealogy(splitThenBlend()));
    const b = JSON.stringify(layoutGenealogy(splitThenBlend()));
    const c = JSON.stringify(layoutGenealogy(splitThenBlend()));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("is invariant to input node/edge array order", () => {
    const g = splitThenBlend();
    const shuffled: LotGenealogy = {
      nodes: [...g.nodes].reverse(),
      edges: [...g.edges].reverse(),
    };
    const fromOrdered = layoutGenealogy(g);
    const fromShuffled = layoutGenealogy(shuffled);
    // Positions keyed by code must match regardless of array order.
    const posOf = (l: ReturnType<typeof layoutGenealogy>) =>
      Object.fromEntries(
        l.nodes.map((n) => [n.code, `${n.x},${n.y},${n.w},${n.h},${n.column}`]),
      );
    expect(posOf(fromShuffled)).toEqual(posOf(fromOrdered));
  });
});

/* ====================================================================== */
/* Output contract — paths, bounds, labels                                */
/* ====================================================================== */

describe("layoutGenealogy — output contract", () => {
  it("emits an SVG path 'd' for every edge", () => {
    const layout = layoutGenealogy(splitThenBlend());
    for (const e of layout.edges) {
      expect(typeof e.d).toBe("string");
      expect(e.d.length).toBeGreaterThan(0);
      expect(e.d).toMatch(/^M/); // a moveto-prefixed path
    }
  });

  it("reports bounds enclosing every node box", () => {
    const layout = layoutGenealogy(splitThenBlend());
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(layout.bounds.x);
      expect(n.y).toBeGreaterThanOrEqual(layout.bounds.y);
      expect(n.x + n.w).toBeLessThanOrEqual(
        layout.bounds.x + layout.bounds.width + 1e-6,
      );
      expect(n.y + n.h).toBeLessThanOrEqual(
        layout.bounds.y + layout.bounds.height + 1e-6,
      );
    }
  });

  it("places a label for every node that never overlaps any node box", () => {
    const layout = layoutGenealogy(splitThenBlend());
    expect(layout.labels.length).toBe(layout.nodes.length);
    for (const label of layout.labels) {
      const lr: Rect = {
        x: label.x,
        y: label.y,
        w: label.w,
        h: label.h,
      };
      for (const n of layout.nodes) {
        expect(
          rectsOverlap(lr, n),
          `label for ${label.code} overlaps node ${n.code}`,
        ).toBe(false);
      }
    }
  });

  it("handles the empty graph without throwing", () => {
    const layout = layoutGenealogy({ nodes: [], edges: [] });
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.bounds.width).toBeGreaterThanOrEqual(0);
  });

  it("handles a single isolated node", () => {
    const layout = layoutGenealogy({ nodes: [node("solo")], edges: [] });
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].column).toBe(0);
  });
});
