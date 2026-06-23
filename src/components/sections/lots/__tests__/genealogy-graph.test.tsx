import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LotGenealogy } from "@/lib/types";
import { GenealogyGraph } from "@/components/sections/lots/genealogy-graph";
import { layoutGenealogy } from "@/lib/ui/graph-layout";

/**
 * A split-then-blend lineage: one cherry intake splits into a Washed and a
 * Natural process arm with HONEST yield-loss (output kg < input kg), then both
 * arms blend into the terminal green lot the family sells.
 *
 *   JC-100 (cherry, 130kg)
 *     ├─split 90kg→ JC-100W (washed, 70kg)  ─blend 70kg→ JC-200 (green, 100kg)
 *     └─split 40kg→ JC-100N (natural, 30kg) ─blend 30kg→
 *
 *  Masses are kept under the 196kg saturation point of ribbonWidth's 28px clamp
 *  so the heavier (90kg) split is strictly thicker than the lighter (40kg) one —
 *  i.e. the "mass is visible" assertion exercises the real curve, not the clamp.
 */
const graph: LotGenealogy = {
  nodes: [
    {
      code: "JC-100",
      stage: "cherry",
      variety: "Geisha",
      originKg: 130,
      currentKg: 130,
      isSingleOrigin: true,
      mintedAt: "2026-05-01",
    },
    {
      code: "JC-100W",
      stage: "parchment",
      variety: "Geisha",
      originKg: 90,
      currentKg: 70,
      isSingleOrigin: true,
      mintedAt: "2026-05-02",
    },
    {
      code: "JC-100N",
      stage: "drying",
      variety: "Geisha",
      originKg: 40,
      currentKg: 30,
      isSingleOrigin: true,
      mintedAt: "2026-05-02",
    },
    {
      code: "JC-200",
      stage: "green",
      variety: "Geisha",
      originKg: 100,
      currentKg: 100,
      isSingleOrigin: false,
      mintedAt: "2026-05-20",
    },
  ],
  edges: [
    { parentCode: "JC-100", childCode: "JC-100W", kind: "split", kg: 90 },
    { parentCode: "JC-100", childCode: "JC-100N", kind: "split", kg: 40 },
    { parentCode: "JC-100W", childCode: "JC-200", kind: "blend", kg: 70 },
    { parentCode: "JC-100N", childCode: "JC-200", kind: "blend", kg: 30 },
  ],
};

describe("<GenealogyGraph> (server SVG)", () => {
  it("renders an SVG graphic with every lot node code", () => {
    render(<GenealogyGraph graph={graph} terminalCode="JC-200" />);
    // The graph carries an accessible role for the figure.
    expect(screen.getByRole("img", { name: /genealogy/i })).toBeInTheDocument();
    for (const code of ["JC-100", "JC-100W", "JC-100N", "JC-200"]) {
      // Code appears (node label and/or tree); at least once.
      expect(screen.getAllByText(code).length).toBeGreaterThan(0);
    }
  });

  it("draws mass-proportional ribbons whose stroke-width reflects kg (heavier edge thicker)", () => {
    const { container } = render(
      <GenealogyGraph graph={graph} terminalCode="JC-200" />,
    );
    // Each edge ribbon is a <path data-edge="parent>child"> carrying its stroke-width.
    const heavy = container.querySelector(
      'path[data-edge="JC-100>JC-100W"]',
    ) as SVGPathElement | null;
    const light = container.querySelector(
      'path[data-edge="JC-100>JC-100N"]',
    ) as SVGPathElement | null;
    expect(heavy).not.toBeNull();
    expect(light).not.toBeNull();

    const sw = (el: SVGPathElement) =>
      Number(el.getAttribute("stroke-width"));
    // 600kg edge is strictly thicker than the 400kg edge — mass is visible.
    expect(sw(heavy!)).toBeGreaterThan(sw(light!));

    // The stroke widths agree with the LOCKED layout's ribbonWidth output
    // (the component must consume the pure layout, not invent its own widths).
    const laid = layoutGenealogy(graph);
    const wByEdge = new Map(
      laid.edges.map((e) => [`${e.parentCode}>${e.childCode}`, e.strokeWidth]),
    );
    expect(sw(heavy!)).toBeCloseTo(wByEdge.get("JC-100>JC-100W")!, 5);
    expect(sw(light!)).toBeCloseTo(wByEdge.get("JC-100>JC-100N")!, 5);
  });

  it("draws yield-loss honestly as a dashed wisp", () => {
    const { container } = render(
      <GenealogyGraph graph={graph} terminalCode="JC-200" />,
    );
    // JC-100W: received 90 kg, forwarded 70 kg (lost 20 kg) and JC-100N: received
    // 40 kg, forwarded 30 kg (lost 10 kg) -> two wisps.
    const dashed = container.querySelectorAll("[stroke-dasharray]");
    expect(dashed.length).toBeGreaterThan(0);
  });

  it("inherits the chart material contract: gloss + groove <defs> (AD-5)", () => {
    const { container } = render(
      <GenealogyGraph graph={graph} terminalCode="JC-200" />,
    );
    const defs = container.querySelector("defs");
    expect(defs).not.toBeNull();
    // A specular gloss gradient and a recessed/groove filter both present.
    expect(container.querySelector('[id*="gloss"]')).not.toBeNull();
    expect(container.querySelector('[id*="groove"]')).not.toBeNull();
  });

  it("gives the terminal node the one glass-sheen (real in-SVG mechanism, not an inert HTML class)", () => {
    const { container } = render(
      <GenealogyGraph graph={graph} terminalCode="JC-200" />,
    );
    // The sheen must be marked with a data attribute on the terminal node group
    // so the test pins the actual node, and exactly one node carries it.
    const sheenedGroups = container.querySelectorAll("[data-terminal-sheen]");
    expect(sheenedGroups.length).toBe(1);
    const group = sheenedGroups[0] as SVGGElement;
    expect(group.getAttribute("data-node")).toBe("JC-200");

    // AND the actual specular mechanism must render IN SVG TERMS — an animated
    // highlight element inside the terminal group — not a `.glass-sheen` HTML
    // class on a <g> (which is a silent CSS no-op: <g> has no ::after box).
    // The sheen sweep is an <animate>/<animateTransform> driven overlay.
    const sweep = group.querySelector("[data-sheen-sweep]");
    expect(sweep).not.toBeNull();
    expect(sweep!.querySelector("animate, animateTransform")).not.toBeNull();

    // Regression guard for the inert-class defect: no SVG <g> wears the
    // HTML-only .glass-sheen class (it never paints on a group element).
    const svg = container.querySelector("[data-graph-svg]")!;
    expect(svg.querySelectorAll("g.glass-sheen").length).toBe(0);
  });

  it("AD-3: every SVG text token sits on an opaque backing chip (no text directly on glass)", () => {
    const { container } = render(
      <GenealogyGraph graph={graph} terminalCode="JC-200" />,
    );
    const svg = container.querySelector("[data-graph-svg]") as SVGSVGElement;
    // Collect every opaque backing rect (the white node cards + any label chips).
    const opaqueRects: { x: number; y: number; w: number; h: number }[] = [];
    svg.querySelectorAll("rect").forEach((rect) => {
      const fill = (rect.getAttribute("fill") ?? "").toLowerCase();
      // Opaque solid chips only: white/cream solid fills, never a url(#gradient)
      // and never a translucent fill.
      const isOpaqueSolid =
        (fill === "#ffffff" || fill === "#fff" || fill === "#fffaf2") &&
        rect.getAttribute("fill-opacity") !== "0";
      if (!isOpaqueSolid) return;
      opaqueRects.push({
        x: Number(rect.getAttribute("x")),
        y: Number(rect.getAttribute("y")),
        w: Number(rect.getAttribute("width")),
        h: Number(rect.getAttribute("height")),
      });
    });

    // Every <text> element's anchor point must fall inside an opaque chip — i.e.
    // no token is painted directly on the translucent glass/gradient floor (AD-3).
    const texts = svg.querySelectorAll("text");
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((t) => {
      const tx = Number(t.getAttribute("x"));
      const ty = Number(t.getAttribute("y"));
      const covered = opaqueRects.some(
        (r) => tx >= r.x && tx <= r.x + r.w && ty >= r.y - r.h && ty <= r.y + r.h,
      );
      expect(
        covered,
        `text "${t.textContent}" at (${tx},${ty}) is not on an opaque chip`,
      ).toBe(true);
    });
  });

  it("renders nothing breaking for an empty graph", () => {
    expect(() =>
      render(<GenealogyGraph graph={{ nodes: [], edges: [] }} />),
    ).not.toThrow();
  });

  it("renders a graceful fallback (never the literal 'null') for a bare seed lot with null stage/variety/kg", () => {
    // Bare seed lots (JC-541..JC-611) were inserted with only `code` — null
    // stage/variety/mass. The graph must show a graceful fallback, never paint
    // the literal string "null" into the SVG or the tree.
    const bare: LotGenealogy = {
      nodes: [
        {
          code: "JC-541",
          // null fields a bare seed carries (cast through unknown — the seed
          // row is genuinely null even though the domain type narrows them).
          stage: null as unknown as string,
          variety: null as unknown as LotGenealogy["nodes"][number]["variety"],
          originKg: null as unknown as number,
          currentKg: null as unknown as number,
          isSingleOrigin: false,
          mintedAt: "2026-05-01",
        },
      ],
      edges: [],
    };

    const { container } = render(
      <GenealogyGraph graph={bare} terminalCode="JC-541" />,
    );

    // The node code still renders…
    expect(screen.getAllByText("JC-541").length).toBeGreaterThan(0);
    // …but NOWHERE in the rendered output is the literal string "null".
    expect(container.textContent ?? "").not.toContain("null");
    // A graceful placeholder is present instead (em-dash or "Unknown").
    expect(container.textContent ?? "").toMatch(/—|Unknown/);
  });
});

describe("role=tree no-JS fallback", () => {
  it("renders a tree from the SAME nodes/edges with edge mass as operable TEXT", () => {
    render(<GenealogyGraph graph={graph} terminalCode="JC-200" />);
    const tree = screen.getByRole("tree");
    expect(tree).toBeInTheDocument();

    const items = within(tree).getAllByRole("treeitem");
    // Every node appears as a treeitem (full lineage, not a summary).
    expect(items.length).toBeGreaterThanOrEqual(graph.nodes.length);

    // Edge mass is present as TEXT (operable, not just a width) — every edge kg.
    const treeText = tree.textContent ?? "";
    for (const e of graph.edges) {
      expect(treeText).toContain(`${e.kg} kg`);
    }
    // The child codes the edges carry are reachable as text in the tree too.
    for (const code of ["JC-100", "JC-100W", "JC-100N", "JC-200"]) {
      expect(within(tree).getAllByText(new RegExp(code)).length).toBeGreaterThan(0);
    }
  });

  it("renders each lineage node's code as an <EntityLink> to its lot dossier (cross-entity coherence)", () => {
    render(<GenealogyGraph graph={graph} terminalCode="JC-200" />);
    const tree = screen.getByRole("tree");

    // Every node in the operable lineage outline is a real link to that lot's
    // dossier — the connectivity mechanism the connected-estate mandate demands.
    for (const code of ["JC-100", "JC-100W", "JC-100N", "JC-200"]) {
      // Anchored so a code is not a substring-match of a longer sibling code
      // (e.g. "JC-100" must not also match "JC-100W"/"JC-100N") — each lineage
      // code resolves to exactly ONE dossier link.
      const link = within(tree).getByRole("link", {
        name: new RegExp(`^abrir lote ${code}$`, "i"),
      });
      expect(link).toHaveAttribute("href", `/lots/${code}`);
    }
  });
});
