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
 * The lot-genealogy graph as `{nodes, edges}` (ADR-003 derived-read).
 *
 * - With no `code`, returns the whole graph: every promoted `lots` node and
 *   every `lot_edges` edge.
 * - With a `code`, scopes to that lot's lineage: the edges that touch the code
 *   (as parent or child) plus the nodes at either endpoint of those edges
 *   (always including the code itself).
 */
export const getLotGenealogy = cache(
  async (code?: string): Promise<LotGenealogy> => {
    const supabase = await getSupabase();

    let edgeQuery = supabase.from("lot_edges").select("*").order("id");
    if (code) {
      edgeQuery = edgeQuery.or(`parent_code.eq.${code},child_code.eq.${code}`);
    }
    const { data: edgeData, error: edgeError } = await edgeQuery;
    if (edgeError) throw new Error(`getLotGenealogy: ${edgeError.message}`);
    const edges = (edgeData as LotEdgeRow[]).map(mapLotEdge);

    const { data: nodeData, error: nodeError } = await supabase
      .from("lots")
      .select("*")
      .order("code");
    if (nodeError) throw new Error(`getLotGenealogy: ${nodeError.message}`);
    let nodes = (nodeData as LotNodeRow[]).map(mapLotNode);

    if (code) {
      const inScope = new Set<string>([code]);
      for (const e of edges) {
        inScope.add(e.parentCode);
        inScope.add(e.childCode);
      }
      nodes = nodes.filter((n) => inScope.has(n.code));
    }

    return { nodes, edges };
  },
);
