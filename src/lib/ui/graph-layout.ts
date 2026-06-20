/**
 * Pure, deterministic lot-genealogy graph layout (AD-1, LOCKED algorithm).
 *
 * Data-in / data-out only — NO React, NO DOM. This is the linchpin of the
 * highest-risk surface (the genealogy graph), so it lives as a pure function
 * that is unit-testable and server-renderable: the `<GenealogyGraph>` server
 * component feeds it `{nodes, edges}` and renders the returned coordinates as
 * SVG, with zero client JS required for the layout itself.
 *
 * The LOCKED algorithm (DESIGN-ADDENDUM AD-1):
 *   1. Layering   — longest-path column assignment (parents strictly left of children).
 *   2. Crossing   — one-sided median-heuristic sweep (deterministic).
 *   3. Ribbon w   — clamp(2px, k·√kg, 28px) (sqrt compresses dynamic range).
 *   4. Ribbon ord — sort by mass at each node so ribbons NEST, never braid.
 *   5. Labels     — collision-avoided; never overlap a node box.
 */

import type { LotEdge, LotGenealogy, LotNode } from "@/lib/types";

/* ---------------- output contract ---------------- */

/** A node positioned in the layout coordinate space. */
export interface PositionedNode extends LotNode {
  column: number; // longest-path layer index (0 = root-most)
  row: number; // ordered position within the column after crossing reduction
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A positioned edge: a mass-proportional Bézier ribbon. */
export interface PositionedEdge extends LotEdge {
  d: string; // SVG path data (cubic Bézier ribbon centerline)
  strokeWidth: number; // clamp(2, k·√kg, 28)
  parentSlot: number; // nesting rank at the source node (sorted by kg desc)
  childSlot: number; // nesting rank at the target node (sorted by kg desc)
}

/** A collision-avoided node label. */
export interface PositionedLabel {
  code: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  labels: PositionedLabel[];
  bounds: LayoutBounds;
}

/* ---------------- layout constants (tuned for the glass mini-cards) ---------------- */

export const NODE_W = 120;
export const NODE_H = 56;
const COL_GAP = 110; // horizontal gap between columns (room for ribbons)
const ROW_GAP = 36; // vertical gap between node rows
const PAD = 24; // outer padding
const LABEL_H = 16;
const LABEL_GAP = 4; // gap between node box and its label
const RIBBON_K = 2; // k in clamp(2, k·√kg, 28)
const RIBBON_MIN = 2;
const RIBBON_MAX = 28;

/**
 * Pitch invariants: the zero-overlap guarantee (AD-1 step 1) rests on these.
 * COL_PITCH >= NODE_W keeps cross-column boxes apart on x; ROW_PITCH >= NODE_H
 * keeps within-column boxes apart on y. Exported so a guard test can pin the
 * precondition rather than relying on the placement being structurally safe.
 */
export const COL_PITCH = NODE_W + COL_GAP;
export const ROW_PITCH = NODE_H + ROW_GAP;

/* ---------------- ribbon width (AD-1 step 3) ---------------- */

/** clamp(2px, k·√kg, 28px) — sqrt compresses dynamic range, clamps protect both ends. */
export function ribbonWidth(kg: number): number {
  const raw = RIBBON_K * Math.sqrt(Math.max(0, kg));
  return Math.min(RIBBON_MAX, Math.max(RIBBON_MIN, raw));
}

/* ---------------- main entry ---------------- */

export function layoutGenealogy(graph: LotGenealogy): GraphLayout {
  const { nodes, edges } = graph;

  if (nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      labels: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  // Stable, code-sorted working copies so output is invariant to input order.
  const nodeByCode = new Map<string, LotNode>();
  for (const n of nodes) nodeByCode.set(n.code, n);
  const codes = [...nodeByCode.keys()].sort();

  // Only keep edges whose endpoints both exist; sort for determinism.
  const validEdges = edges
    .filter((e) => nodeByCode.has(e.parentCode) && nodeByCode.has(e.childCode))
    .slice()
    .sort(
      (a, b) =>
        a.parentCode.localeCompare(b.parentCode) ||
        a.childCode.localeCompare(b.childCode),
    );

  // 1. LAYERING — longest-path column assignment.
  const column = assignColumns(codes, validEdges);

  // Group node codes by column.
  const maxCol = Math.max(...codes.map((c) => column.get(c)!));
  const columns: string[][] = Array.from({ length: maxCol + 1 }, () => []);
  for (const c of codes) columns[column.get(c)!].push(c);
  // Deterministic initial order within a column: by code.
  for (const col of columns) col.sort();

  // 2. CROSSING REDUCTION — one-sided median-heuristic sweeps.
  reduceCrossings(columns, validEdges);

  // Final row index per node.
  const row = new Map<string, number>();
  for (const col of columns) {
    col.forEach((code, i) => row.set(code, i));
  }

  // 3 + 4 happen below when building edges. First place nodes.
  const positioned = placeNodes(nodeByCode, column, row, columns);
  const posByCode = new Map(positioned.map((n) => [n.code, n]));

  const positionedEdges = buildEdges(validEdges, posByCode);
  const labels = placeLabels(positioned, posByCode);

  const bounds = computeBounds(positioned, labels);

  return { nodes: positioned, edges: positionedEdges, labels, bounds };
}

/* ---------------- 1. longest-path layering ---------------- */

/**
 * Longest-path column assignment: column(n) = longest chain of edges from any
 * root to n. Guarantees every parent is in a STRICTLY smaller column than each
 * child (the column invariant), and uses the LONGEST path (so a node reachable
 * by both a short and a long route lands at the long route's depth).
 */
function assignColumns(
  codes: string[],
  edges: LotEdge[],
): Map<string, number> {
  const children = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const c of codes) {
    children.set(c, []);
    indeg.set(c, 0);
  }
  for (const e of edges) {
    children.get(e.parentCode)!.push(e.childCode);
    indeg.set(e.childCode, (indeg.get(e.childCode) ?? 0) + 1);
  }

  // Kahn topological order (deterministic: process ready nodes in code order).
  const col = new Map<string, number>();
  for (const c of codes) col.set(c, 0);

  const ready = codes.filter((c) => indeg.get(c) === 0).sort();
  const indegWork = new Map(indeg);
  const order: string[] = [];
  while (ready.length > 0) {
    const c = ready.shift()!;
    order.push(c);
    for (const ch of children.get(c)!) {
      // Longest path: child column is at least parent column + 1.
      if (col.get(ch)! < col.get(c)! + 1) col.set(ch, col.get(c)! + 1);
      indegWork.set(ch, indegWork.get(ch)! - 1);
      if (indegWork.get(ch) === 0) {
        // insert keeping `ready` sorted for determinism
        const idx = lowerBound(ready, ch);
        ready.splice(idx, 0, ch);
      }
    }
  }
  return col;
}

function lowerBound(arr: string[], value: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* ---------------- 2. crossing reduction (one-sided median) ---------------- */

/**
 * One-sided median-heuristic sweep. For each column (left→right then
 * right→left), reorder its nodes by the median position of their neighbours in
 * the adjacent already-fixed column. Deterministic: stable tie-breaks by code,
 * fixed number of sweeps.
 */
function reduceCrossings(columns: string[][], edges: LotEdge[]): void {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!children.has(e.parentCode)) children.set(e.parentCode, []);
    children.get(e.parentCode)!.push(e.childCode);
    if (!parents.has(e.childCode)) parents.set(e.childCode, []);
    parents.get(e.childCode)!.push(e.parentCode);
  }

  const SWEEPS = 4;
  for (let s = 0; s < SWEEPS; s++) {
    // Forward sweep: order each column by median of PARENTS (left column).
    for (let c = 1; c < columns.length; c++) {
      orderByMedian(columns[c], columns[c - 1], parents);
    }
    // Backward sweep: order each column by median of CHILDREN (right column).
    for (let c = columns.length - 2; c >= 0; c--) {
      orderByMedian(columns[c], columns[c + 1], children);
    }
  }
}

function orderByMedian(
  col: string[],
  adjacent: string[],
  neighbours: Map<string, string[]>,
): void {
  const posInAdjacent = new Map<string, number>();
  adjacent.forEach((code, i) => posInAdjacent.set(code, i));

  // Decorate with median (and original index for stable tie-breaks).
  const decorated = col.map((code, originalIndex) => {
    const ns = (neighbours.get(code) ?? [])
      .map((n) => posInAdjacent.get(n))
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    let median: number;
    if (ns.length === 0) {
      // No fixed neighbours: keep current relative position (anchor in place).
      median = originalIndex;
    } else {
      const m = ns.length;
      median =
        m % 2 === 1
          ? ns[(m - 1) / 2]
          : (ns[m / 2 - 1] + ns[m / 2]) / 2;
    }
    return { code, median, originalIndex };
  });

  decorated.sort(
    (a, b) =>
      a.median - b.median ||
      a.originalIndex - b.originalIndex ||
      a.code.localeCompare(b.code),
  );

  for (let i = 0; i < col.length; i++) col[i] = decorated[i].code;
}

/* ---------------- node placement ---------------- */

function placeNodes(
  nodeByCode: Map<string, LotNode>,
  column: Map<string, number>,
  row: Map<string, number>,
  columns: string[][],
): PositionedNode[] {
  // Vertically center each column around a common axis so the figure is balanced.
  const maxRows = Math.max(...columns.map((c) => c.length), 1);
  const totalHeight = maxRows * ROW_PITCH - ROW_GAP;

  // Emit in code order so output ordering is deterministic.
  const codes = [...nodeByCode.keys()].sort();
  const out: PositionedNode[] = [];
  for (const code of codes) {
    const base = nodeByCode.get(code)!;
    const col = column.get(code)!;
    const rowIdx = row.get(code)!;
    const colCount = columns[col].length;
    const colHeight = colCount * ROW_PITCH - ROW_GAP;
    const yOffset = (totalHeight - colHeight) / 2;
    const x = PAD + col * COL_PITCH;
    const y = PAD + yOffset + rowIdx * ROW_PITCH;
    out.push({
      ...base,
      column: col,
      row: rowIdx,
      x: r(x),
      y: r(y),
      w: NODE_W,
      h: NODE_H,
    });
  }
  return out;
}

/* ---------------- edges (steps 3 + 4): ribbons, nested by mass ---------------- */

function buildEdges(
  edges: LotEdge[],
  posByCode: Map<string, PositionedNode>,
): PositionedEdge[] {
  // 4. RIBBON ORDERING — at each node, sort incident edges by mass (desc) so the
  //    heaviest ribbon hugs the center and lighter ones nest outward: never braid.
  const outSlots = slotMap(edges, (e) => e.parentCode);
  const inSlots = slotMap(edges, (e) => e.childCode);

  return edges.map((e) => {
    const p = posByCode.get(e.parentCode)!;
    const c = posByCode.get(e.childCode)!;
    const parentSlot = outSlots.get(edgeKey(e))!;
    const childSlot = inSlots.get(edgeKey(e))!;

    const outDeg = countAt(edges, (x) => x.parentCode === e.parentCode);
    const inDeg = countAt(edges, (x) => x.childCode === e.childCode);

    const sx = p.x + p.w;
    const sy = anchorY(p, parentSlot, outDeg);
    const tx = c.x;
    const ty = anchorY(c, childSlot, inDeg);

    return {
      ...e,
      strokeWidth: ribbonWidth(e.kg),
      parentSlot,
      childSlot,
      d: bezier(sx, sy, tx, ty),
    };
  });
}

/**
 * Compute the nesting slot of each edge at the node selected by `keyFn`.
 * Slot 0 is the heaviest edge (center-most); higher slots nest outward.
 */
function slotMap(
  edges: LotEdge[],
  keyFn: (e: LotEdge) => string,
): Map<string, number> {
  const groups = new Map<string, LotEdge[]>();
  for (const e of edges) {
    const k = keyFn(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  const slot = new Map<string, number>();
  for (const group of groups.values()) {
    // Sort by mass DESC; deterministic tie-break by the other endpoint + kind.
    const sorted = [...group].sort(
      (a, b) =>
        b.kg - a.kg ||
        a.parentCode.localeCompare(b.parentCode) ||
        a.childCode.localeCompare(b.childCode) ||
        a.kind.localeCompare(b.kind),
    );
    sorted.forEach((e, i) => slot.set(edgeKey(e), i));
  }
  return slot;
}

function edgeKey(e: LotEdge): string {
  return `${e.parentCode}>${e.childCode}|${e.kind}|${e.kg}`;
}

function countAt(edges: LotEdge[], pred: (e: LotEdge) => boolean): number {
  let n = 0;
  for (const e of edges) if (pred(e)) n++;
  return n;
}

/**
 * Vertical anchor for ribbon slot `slot` of `deg` total, fanned across the node
 * face. Slot 0 (heaviest) sits at center; alternating slots fan symmetrically
 * outward so the heaviest ribbon runs through the middle (nesting, not braiding).
 */
function anchorY(node: PositionedNode, slot: number, deg: number): number {
  const center = node.y + node.h / 2;
  if (deg <= 1) return center;
  // Map nesting slot (0=center) to a fan offset. Even slots above, odd below.
  const span = node.h * 0.7;
  const step = span / (deg + 1);
  // Convert slot rank to a signed lane: 0 -> 0, 1 -> +1, 2 -> -1, 3 -> +2 ...
  const lane =
    slot === 0 ? 0 : slot % 2 === 1 ? Math.ceil(slot / 2) : -Math.ceil(slot / 2);
  return center + lane * step;
}

/** Smooth cubic Bézier centerline between two horizontal anchors. */
function bezier(sx: number, sy: number, tx: number, ty: number): string {
  const dx = (tx - sx) * 0.5;
  const c1x = sx + dx;
  const c2x = tx - dx;
  return `M${r(sx)},${r(sy)} C${r(c1x)},${r(sy)} ${r(c2x)},${r(ty)} ${r(tx)},${r(ty)}`;
}

function r(n: number): number {
  // Round to 2dp so output is byte-stable and free of FP drift.
  return Math.round(n * 100) / 100;
}

/* ---------------- labels (step 5): collision-avoided ---------------- */

function placeLabels(
  nodes: PositionedNode[],
  posByCode: Map<string, PositionedNode>,
): PositionedLabel[] {
  // Place each label directly UNDER its node box (outside it, so it can never
  // overlap its own node). Then resolve any overlap against OTHER node boxes by
  // flipping above; node columns are gapped by ROW_GAP (>= LABEL_H+LABEL_GAP),
  // so the label band never collides with a sibling box.
  return nodes.map((n) => {
    const w = NODE_W;
    const below: PositionedLabel = {
      code: n.code,
      text: n.code,
      x: n.x,
      y: n.y + n.h + LABEL_GAP,
      w,
      h: LABEL_H,
    };
    if (!overlapsAnyNode(below, nodes)) return below;

    const above: PositionedLabel = {
      ...below,
      y: n.y - LABEL_GAP - LABEL_H,
    };
    if (!overlapsAnyNode(above, nodes)) return above;

    // Fallback: shift further below until clear (bounded loop).
    let y = below.y;
    for (let i = 0; i < 8; i++) {
      const cand = { ...below, y };
      if (!overlapsAnyNode(cand, nodes)) return cand;
      y += LABEL_H + LABEL_GAP;
    }
    return { ...below, y };
  });
}

function overlapsAnyNode(label: PositionedLabel, nodes: PositionedNode[]): boolean {
  for (const n of nodes) {
    if (
      label.x < n.x + n.w &&
      n.x < label.x + label.w &&
      label.y < n.y + n.h &&
      n.y < label.y + label.h
    ) {
      return true;
    }
  }
  return false;
}

/* ---------------- bounds ---------------- */

function computeBounds(
  nodes: PositionedNode[],
  labels: PositionedLabel[],
): LayoutBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const n of nodes) consider(n.x, n.y, n.w, n.h);
  for (const l of labels) consider(l.x, l.y, l.w, l.h);
  return {
    x: r(minX - PAD),
    y: r(minY - PAD),
    width: r(maxX - minX + 2 * PAD),
    height: r(maxY - minY + 2 * PAD),
  };
}
