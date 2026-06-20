import type { LotEdge, LotGenealogy, LotNode } from "@/lib/types";
import { layoutGenealogy, type PositionedNode } from "@/lib/ui/graph-layout";
import { LotGraphInteractive } from "./lot-graph-interactive.client";
import { cn, kg } from "@/lib/utils";

/**
 * <GenealogyGraph> — the S6 lot-genealogy surface, SERVER-rendered SVG.
 *
 * The layout (DESIGN-ADDENDUM AD-1, LOCKED) is a pure function (`layoutGenealogy`),
 * so this component just prints its coordinates: it works with JavaScript OFF,
 * has a cheap render test, and ships near-zero client JS. A thin client island
 * (`<LotGraphInteractive>`, ~1.5KB) WRAPS the printed SVG to add transform/opacity
 * pan-zoom + a 1-hop neighbor highlight — it is never required for the graph to render.
 *
 * Mass-flow alluvial reading:
 *   • nodes are stage-colored mini glass-cards in time-ordered (longest-path) columns;
 *   • edges are mass-proportional Bézier ribbons — stroke-width ∝ √kg from the
 *     layout, so the mass carried down the lineage is literally visible;
 *   • yield-loss (input kg > output kg at a node) is drawn honestly as a dashed
 *     wisp falling away from the node — the family SEES what processing removed;
 *   • the terminal node (the bag they sell) gets the one `glass-sheen`.
 *
 * AD-3 (WCAG-AA on glass): every code/figure renders on an OPAQUE inner chip
 * (a filled <rect>/<tspan> background), never as text painted directly on a
 * ribbon or gradient.
 *
 * D18 graceful degradation: a `role="tree"` outline built from the SAME nodes/
 * edges renders alongside, with edge mass as TEXT — operable (not merely
 * summarized) when JS is off or `prefers-reduced-motion` is set. The SVG is a
 * `role="img"` summary graphic (with an aria-label); the role="tree" outline is
 * the operable lineage. AT users get the img summary AND the navigable tree.
 */

/* Stage → forest/coffee/honey palette (matches the design token system). */
const STAGE_FILL: Record<string, string> = {
  cherry: "#b5482e",
  fermentation: "#8a6f48",
  drying: "#c8922e",
  parchment: "#8a6f48",
  milled: "#6fae97",
  green: "#1a6b4d",
};

function stageFill(stage: string): string {
  return STAGE_FILL[stage] ?? "#6c6155";
}

/** Content-hashed UID so multiple graphs on one page never share <defs> ids. */
function graphUid(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export interface GenealogyGraphProps {
  graph: LotGenealogy;
  /** The lineage's terminal lot (the bag being sold) — gets the one sheen. */
  terminalCode?: string;
  className?: string;
}

export function GenealogyGraph({
  graph,
  terminalCode,
  className,
}: GenealogyGraphProps) {
  const layout = layoutGenealogy(graph);
  const { nodes, edges, bounds } = layout;

  if (nodes.length === 0) {
    return (
      <div className={cn("glass-card rounded-2xl p-8 text-center", className)}>
        <p className="text-sm text-muted-fg">No lineage to display.</p>
      </div>
    );
  }

  // Resolve the terminal node: the explicit prop, else the right-most/green node.
  const terminal = resolveTerminal(nodes, terminalCode);

  const uid = graphUid(
    `${nodes.map((n) => n.code).join(",")}|${edges
      .map((e) => `${e.parentCode}>${e.childCode}:${e.kg}`)
      .join(",")}|${terminal ?? ""}`,
  );
  const glossId = `graph-gloss-${uid}`;
  const grooveId = `graph-groove-${uid}`;
  const glowId = `graph-glow-${uid}`;
  const sheenId = `graph-sheen-${uid}`;

  // Yield-loss wisps: at each node where forwarded mass < incoming/origin mass,
  // draw a dashed strand falling off the node face representing the lost kg.
  const wisps = yieldLossWisps(nodes, edges);

  const ariaLabel = `Lot genealogy graph: ${nodes.length} lots, ${edges.length} mass transfers.`;

  return (
    <div className={cn("glass-card overflow-hidden rounded-2xl", className)}>
      <LotGraphInteractive
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        ariaLabel={ariaLabel}
      >
        <svg
          width={bounds.width}
          height={bounds.height}
          viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
          role="img"
          aria-label={ariaLabel}
          className="block max-w-full"
          data-graph-svg
        >
          <defs>
            {/* Recessed groove: the ribbons sit in a soft carved channel. */}
            <linearGradient id={grooveId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e2d8c8" stopOpacity="0.0" />
              <stop offset="50%" stopColor="#7c6f5c" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
            </linearGradient>

            {/* Specular gloss: a top highlight swept across node chips. */}
            <linearGradient id={glossId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
              <stop offset="45%" stopColor="#ffffff" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>

            {/* Terminal sheen sweep: a bright specular band that translates
                across the sold lot's card (the spec's one glass-sheen). */}
            <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>

            {/* Soft outer glow lifting ribbons off the living background. */}
            <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="2"
                floodColor="#1b1712"
                floodOpacity="0.16"
              />
            </filter>
          </defs>

          {/* ---- edges: mass-proportional ribbons, nested (heaviest centered) ---- */}
          <g data-layer="ribbons" fill="none">
            {edges.map((e) => {
              const lineage = `${e.parentCode} ${e.childCode}`;
              return (
                <g key={`${e.parentCode}>${e.childCode}:${e.kind}:${e.kg}`}>
                  {/* groove shadow under the ribbon */}
                  <path
                    d={e.d}
                    stroke={`url(#${grooveId})`}
                    strokeWidth={e.strokeWidth + 3}
                    strokeLinecap="round"
                  />
                  {/* the ribbon itself — width ∝ √kg, color from the source stage */}
                  <path
                    d={e.d}
                    data-edge={`${e.parentCode}>${e.childCode}`}
                    data-lineage={lineage}
                    stroke={stageFill(
                      nodes.find((n) => n.code === e.parentCode)?.stage ?? "",
                    )}
                    strokeOpacity={0.5}
                    strokeWidth={e.strokeWidth}
                    strokeLinecap="round"
                    filter={`url(#${glowId})`}
                  >
                    <title>
                      {e.parentCode} → {e.childCode}: {kg(e.kg)} ({e.kind})
                    </title>
                  </path>
                </g>
              );
            })}
          </g>

          {/* ---- yield-loss: honest dashed wisps falling off the node face ---- */}
          <g data-layer="yield-loss" fill="none">
            {wisps.map((w) => (
              <path
                key={`wisp-${w.code}`}
                d={w.d}
                stroke="#b5482e"
                strokeOpacity={0.45}
                strokeWidth={w.strokeWidth}
                strokeDasharray="3 5"
                strokeLinecap="round"
                data-yield-loss={w.code}
              >
                <title>
                  {w.code}: {kg(w.lostKg)} yield loss
                </title>
              </path>
            ))}
          </g>

          {/* ---- nodes: stage-colored mini glass-cards, AA chip per code ---- */}
          <g data-layer="nodes">
            {nodes.map((n) => {
              const isTerminal = n.code === terminal;
              return (
                <g
                  key={n.code}
                  data-node={n.code}
                  data-lineage={n.code}
                  data-terminal-sheen={isTerminal ? "" : undefined}
                >
                  {/* node card */}
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx={12}
                    fill="#ffffff"
                    stroke={stageFill(n.stage)}
                    strokeWidth={isTerminal ? 2.5 : 1.5}
                  />
                  {/* stage color spine on the left edge */}
                  <rect
                    x={n.x}
                    y={n.y}
                    width={6}
                    height={n.h}
                    rx={3}
                    fill={stageFill(n.stage)}
                  />
                  {/* specular gloss across the top of the card */}
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx={12}
                    fill={`url(#${glossId})`}
                    className="pointer-events-none"
                  />
                  {/* AA: code on the card, full-weight ink (opaque white card). */}
                  <text
                    x={n.x + 14}
                    y={n.y + 22}
                    fontSize={13}
                    fontWeight={700}
                    fill="#1b1712"
                  >
                    {n.code}
                  </text>
                  {/* stage + mass readout, muted ink, on the opaque card. */}
                  <text
                    x={n.x + 14}
                    y={n.y + 40}
                    fontSize={11}
                    fill="#6c6155"
                  >
                    {String(n.stage)} · {kg(n.currentKg)}
                  </text>
                  {/* AD-3: the redundant collision-avoided label-band <text> was
                      removed — the code is already on the opaque white node card
                      above, and the band painted directly on the translucent
                      glass floor (a known-floor 0.7-alpha gradient over drifting
                      aurora) could drop below the 4.5:1 contrast floor. The pure
                      layout still emits `labels` for callers; this SVG just
                      doesn't re-draw the duplicate text on glass. */}
                  {/* Terminal sheen: an in-SVG specular sweep (the spec's one
                      glass-sheen). Implemented in SVG terms — a clipped bright
                      band that translates across the card on a loop — because a
                      `.glass-sheen` HTML class on an SVG <g> is a silent no-op
                      (groups generate no ::after positioned box). Honors
                      prefers-reduced-motion: the <animate> is paused there. */}
                  {isTerminal && (
                    <g data-sheen-host>
                      <clipPath id={`sheen-clip-${uid}`}>
                        <rect
                          x={n.x}
                          y={n.y}
                          width={n.w}
                          height={n.h}
                          rx={12}
                        />
                      </clipPath>
                      <g
                        data-sheen-sweep
                        clipPath={`url(#sheen-clip-${uid})`}
                        className="pointer-events-none motion-reduce:hidden"
                      >
                        <rect
                          x={n.x - n.w}
                          y={n.y}
                          width={n.w * 0.6}
                          height={n.h}
                          fill={`url(#${sheenId})`}
                          transform={`skewX(-18)`}
                        >
                          <animateTransform
                            attributeName="transform"
                            type="translate"
                            from="0 0"
                            to={`${n.w * 2.2} 0`}
                            dur="2.6s"
                            begin="0s"
                            repeatCount="indefinite"
                            additive="sum"
                          />
                        </rect>
                      </g>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </LotGraphInteractive>

      {/* D18: the operable role="tree" fallback from the SAME data. */}
      <GenealogyTree graph={graph} terminalCode={terminal} />
    </div>
  );
}

/* ---------------- terminal resolution ---------------- */

function resolveTerminal(
  nodes: PositionedNode[],
  explicit?: string,
): string | undefined {
  if (explicit && nodes.some((n) => n.code === explicit)) return explicit;
  // Else the right-most column; tie-break to a green node, then by code.
  const maxCol = Math.max(...nodes.map((n) => n.column));
  const last = nodes.filter((n) => n.column === maxCol);
  const green = last.find((n) => n.stage === "green");
  if (green) return green.code;
  return [...last].sort((a, b) => a.code.localeCompare(b.code))[0]?.code;
}

/* ---------------- yield-loss wisps ---------------- */

interface Wisp {
  code: string;
  lostKg: number;
  strokeWidth: number;
  d: string;
}

/**
 * Honest yield-loss: where the mass a node forwards out (Σ outgoing edge kg) is
 * less than the mass it received in (Σ incoming edge kg, or its originKg for a
 * root), the difference is processing loss — drawn as a dashed wisp dropping off
 * the bottom of the node face. Mass made visible, including what's removed.
 */
function yieldLossWisps(nodes: PositionedNode[], edges: LotEdge[]): Wisp[] {
  const inByNode = new Map<string, number>();
  const outByNode = new Map<string, number>();
  for (const e of edges) {
    outByNode.set(e.parentCode, (outByNode.get(e.parentCode) ?? 0) + e.kg);
    inByNode.set(e.childCode, (inByNode.get(e.childCode) ?? 0) + e.kg);
  }

  const out: Wisp[] = [];
  for (const n of nodes) {
    const received = inByNode.get(n.code) ?? n.originKg;
    const forwarded = outByNode.get(n.code) ?? 0;
    // Only nodes that BOTH forward something and lose something get a wisp
    // (a terminal node keeps its mass as product, not as loss).
    if (forwarded <= 0) continue;
    const lost = received - forwarded;
    if (lost <= 0.0001) continue;

    const sx = n.x + n.w * 0.5;
    const sy = n.y + n.h;
    const ex = sx + 14;
    const ey = sy + 26;
    out.push({
      code: n.code,
      lostKg: Math.round(lost),
      strokeWidth: ribbonish(lost),
      d: `M${sx},${sy} C${sx},${sy + 14} ${ex},${ey - 10} ${ex},${ey}`,
    });
  }
  return out;
}

/** Compress wisp width like ribbons but thinner (loss is a wisp, not a flow). */
function ribbonish(kgVal: number): number {
  return Math.min(10, Math.max(1.5, Math.sqrt(Math.max(0, kgVal)) * 0.9));
}

/* ---------------- role="tree" fallback ---------------- */

/**
 * GenealogyTree — the operable D18 fallback. A `role="tree"` of the same nodes;
 * each node's outgoing edges are nested `treeitem`s carrying their mass as TEXT
 * (so the lineage is navigable and the kg readable, not just a visual width).
 * Roots (no incoming edges) are the top level; the walk is depth-first.
 */
function GenealogyTree({
  graph,
  terminalCode,
}: {
  graph: LotGenealogy;
  terminalCode?: string;
}) {
  const { nodes, edges } = graph;
  const byCode = new Map(nodes.map((n) => [n.code, n]));
  const childEdges = new Map<string, LotEdge[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    if (!childEdges.has(e.parentCode)) childEdges.set(e.parentCode, []);
    childEdges.get(e.parentCode)!.push(e);
    hasParent.add(e.childCode);
  }

  const roots = nodes
    .filter((n) => !hasParent.has(n.code))
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <ul
      role="tree"
      aria-label="Lot genealogy outline"
      className="border-line border-t p-4 text-sm"
    >
      {roots.map((r) => (
        <TreeNode
          key={r.code}
          node={r}
          childEdges={childEdges}
          byCode={byCode}
          edgeKg={null}
          terminalCode={terminalCode}
          seen={new Set()}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  childEdges,
  byCode,
  edgeKg,
  terminalCode,
  seen,
}: {
  node: LotNode;
  childEdges: Map<string, LotEdge[]>;
  byCode: Map<string, LotNode>;
  edgeKg: { kind: string; kg: number } | null;
  terminalCode?: string;
  seen: Set<string>;
}) {
  // Guard against accidental cycles in malformed data.
  if (seen.has(node.code)) {
    return (
      <li role="treeitem" className="text-muted-fg pl-2">
        {node.code} (already shown)
      </li>
    );
  }
  const nextSeen = new Set(seen);
  nextSeen.add(node.code);

  const kids = (childEdges.get(node.code) ?? [])
    .slice()
    .sort(
      (a, b) =>
        b.kg - a.kg ||
        a.childCode.localeCompare(b.childCode) ||
        a.kind.localeCompare(b.kind),
    );
  const isTerminal = node.code === terminalCode;

  return (
    <li role="treeitem" aria-expanded={kids.length > 0 ? true : undefined}>
      <span className="text-ink inline-flex flex-wrap items-baseline gap-2 py-1">
        <span className="font-medium">{node.code}</span>
        <span className="text-muted-fg text-xs">
          {String(node.stage)} · {kg(node.currentKg)}
        </span>
        {edgeKg && (
          <span className="text-muted-fg text-xs">
            — {edgeKg.kind} {kg(edgeKg.kg)}
          </span>
        )}
        {isTerminal && (
          <span className="text-forest text-xs font-semibold">(sold lot)</span>
        )}
      </span>
      {kids.length > 0 && (
        <ul role="group" className="border-line ml-3 border-l pl-3">
          {kids.map((e) => {
            const child = byCode.get(e.childCode);
            if (!child) return null;
            return (
              <TreeNode
                key={`${e.parentCode}>${e.childCode}:${e.kind}:${e.kg}`}
                node={child}
                childEdges={childEdges}
                byCode={byCode}
                edgeKg={{ kind: e.kind, kg: e.kg }}
                terminalCode={terminalCode}
                seen={nextSeen}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}
