import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  CoffeeVariety,
  LotEdge,
  LotGenealogy,
  LotNode,
} from "@/lib/types";

/** Traceability lot codes (JC-###) — used by the harvest + processing forms. */
export const getLots = cache(async (): Promise<string[]> => {
  const { data, error } = await (await getSupabase())
    .from("lots")
    .select("code")
    .order("code");
  if (error) throw new Error(`getLots: ${error.message}`);
  return (data as { code: string }[]).map((r) => r.code);
});

/* ---------------- Lot graph (genealogy DAG) — S3 ---------------- */

/** Shape of a `lots` graph-node row as returned by PostgREST (snake_case). */
export interface LotNodeRow {
  code: string;
  stage: LotNode["stage"];
  variety: CoffeeVariety;
  origin_kg: number | string | null;
  current_kg: number | string | null;
  is_single_origin: boolean;
  minted_at: string;
}

/** Shape of a `lot_edges` row as returned by PostgREST (snake_case). */
export interface LotEdgeRow {
  parent_code: string;
  child_code: string;
  kind: LotEdge["kind"];
  kg: number | string;
}

/** Pure row → domain mapper for a genealogy node (numeric coercion; null mass → 0). */
export function mapLotNode(r: LotNodeRow): LotNode {
  return {
    code: r.code,
    stage: r.stage,
    variety: r.variety,
    originKg: Number(r.origin_kg ?? 0),
    currentKg: Number(r.current_kg ?? 0),
    isSingleOrigin: r.is_single_origin,
    mintedAt: r.minted_at,
  };
}

/** Pure row → domain mapper for a genealogy edge (numeric coercion of mass). */
export function mapLotEdge(r: LotEdgeRow): LotEdge {
  return {
    parentCode: r.parent_code,
    childCode: r.child_code,
    kind: r.kind,
    kg: Number(r.kg),
  };
}

/**
 * Canonical traceability lot-code shape: `JC-` followed by ≥3 digits. This is the
 * ONLY value the genealogy read accepts for a scoped query — validating it up
 * front means raw URL text can never reach a PostgREST filter string (the S3
 * read-filter injection surface, review findings #32/#38).
 */
export const LOT_CODE_RE = /^JC-\d{3,}$/;

/** Whether a string is a well-formed JC-### traceability code. */
export function isLotCode(code: string): boolean {
  return LOT_CODE_RE.test(code);
}

/**
 * Walk the connected component containing `code` over an undirected view of the
 * edges — i.e. both ANCESTORS and DESCENDANTS, transitively. Returns the set of
 * lot codes reachable from `code` along edges in either direction (always
 * including `code` itself). A green lot therefore surfaces its WHOLE cherry→…→green
 * lineage, not just the edges that happen to touch it directly (finding #17).
 */
function connectedComponent(code: string, edges: LotEdge[]): Set<string> {
  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(to);
  };
  for (const e of edges) {
    // Treat each edge as undirected so the walk reaches both up and downstream.
    link(e.parentCode, e.childCode);
    link(e.childCode, e.parentCode);
  }

  const inScope = new Set<string>([code]);
  const stack = [code];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!inScope.has(next)) {
        inScope.add(next);
        stack.push(next);
      }
    }
  }
  return inScope;
}

/**
 * The lot-genealogy graph as `{nodes, edges}` (ADR-003 derived-read).
 *
 * - With no `code`, returns the whole graph: every promoted `lots` node and
 *   every `lot_edges` edge.
 * - With a `code`, scopes to that lot's FULL connected lineage: every node and
 *   edge in the connected component containing `code`, walked transitively over
 *   both parents and children (cherry→…→green, not just the 1-hop neighbours).
 *
 * `code` is validated against `^JC-\d{3,}$` before use; a non-conforming code
 * (the injection surface, findings #32/#38) yields an EMPTY graph and never
 * reaches a query filter — the page treats an empty graph as `notFound()`.
 *
 * The scope is derived in JS from the full edge/node sets fetched with
 * parameter-free queries, so raw `code` text is never interpolated into a
 * PostgREST `.or()`/filter string.
 */
export const getLotGenealogy = cache(
  async (code?: string): Promise<LotGenealogy> => {
    // Validate a scoped code BEFORE any query: a malformed/injection code is
    // rejected to an empty graph and never reaches the database.
    if (code !== undefined && !isLotCode(code)) {
      return { nodes: [], edges: [] };
    }

    const supabase = await getSupabase();

    // Fetch the full edge + node sets with parameter-free queries (no raw user
    // text in any filter string); scope to the lineage in JS below.
    const { data: edgeData, error: edgeError } = await supabase
      .from("lot_edges")
      .select("*")
      .order("id");
    if (edgeError) throw new Error(`getLotGenealogy: ${edgeError.message}`);
    let edges = (edgeData as LotEdgeRow[]).map(mapLotEdge);

    const { data: nodeData, error: nodeError } = await supabase
      .from("lots")
      .select("*")
      .order("code");
    if (nodeError) throw new Error(`getLotGenealogy: ${nodeError.message}`);
    let nodes = (nodeData as LotNodeRow[]).map(mapLotNode);

    if (code) {
      // Walk the FULL connected component (ancestors AND descendants) from code.
      const inScope = connectedComponent(code, edges);
      nodes = nodes.filter((n) => inScope.has(n.code));
      edges = edges.filter(
        (e) => inScope.has(e.parentCode) && inScope.has(e.childCode),
      );
    }

    return { nodes, edges };
  },
);
