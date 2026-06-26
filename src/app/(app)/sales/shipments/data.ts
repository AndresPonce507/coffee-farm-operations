import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import {
  DOC_KINDS,
  ISSUE_ORDER,
  type BuildableContract,
  type DocKind,
  type DocReadiness,
  type IssuedDoc,
  type LoadableLine,
  type ShipmentDetail,
  type ShipmentLineRow,
  type ShipmentRow,
  type ShipmentStatus,
} from "@/app/(app)/sales/shipments/types";

// Re-export the pure type/constant surface so this module's public API (the RSC + test
// callers' import path) is unchanged. The runtime constants now live in the server-free
// `types.ts`, so the `doc-pack.client.tsx` island can import them without pulling
// `next/headers` into the client bundle (the build-breaking server/client boundary cross).
export {
  DOC_KINDS,
  ISSUE_ORDER,
  type BuildableContract,
  type DocKind,
  type DocReadiness,
  type IssuedDoc,
  type LoadableLine,
  type ShipmentDetail,
  type ShipmentLineRow,
  type ShipmentRow,
  type ShipmentStatus,
};

/**
 * /sales/shipments read port (P3-S3 export shipments + export-doc-pack engine).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S3 migration shipped — `export_shipments` / `export_shipment_lines`
 * / `export_documents`, the `v_export_pack_readiness` traffic-light view, the
 * `v_export_doc_pack` issued-doc view, and the S1 `sales_contracts` / `b2b_buyers` /
 * `contract_lines` tables it joins for the consignee block — rather than to the
 * sibling `@/lib/db/b2b` port. Two reasons (mirroring pricing/data.ts): (1) a parallel
 * fan-out builds that port in a sibling file, and importing a not-yet-existent module
 * hard-fails Vite's import-analysis at both test and build time; (2) the only contract
 * that is load-bearing here is the view/column/RPC names, which are frozen. The Wiring
 * pass can collapse this into `@/lib/db/b2b` (one import swap) once that port lands.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`. The
 * headline gate — an export doc cannot issue without its prerequisites — is evaluated
 * in the database (`export_doc_prereqs_unmet` → `issue_export_doc`); this port only
 * SURFACES the live verdict (`v_export_pack_readiness.unmet_prereqs`), never re-derives
 * it. A blocked doc shows the EXACT unmet labels the database returned (auditor-honest,
 * never a fabricated all-clear).
 */

/** Coerce a PostgREST numeric (which may arrive as a string) to a number. */
const n = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

const STATUS_SET = new Set<ShipmentStatus>([
  "building",
  "docs_issued",
  "departed",
  "arrived",
  "closed",
]);
function asStatus(v: string | null | undefined): ShipmentStatus {
  return v && STATUS_SET.has(v as ShipmentStatus) ? (v as ShipmentStatus) : "building";
}

const DOC_SET = new Set<DocKind>(DOC_KINDS);
function asDocKind(v: string): DocKind | null {
  return DOC_SET.has(v as DocKind) ? (v as DocKind) : null;
}

interface ShipmentTableRow {
  id: number;
  contract_id: number;
  shipment_no: string;
  port_of_loading: string;
  bag_weight_kg: number | string;
  status: string;
  departed_at: string | null;
  created_at: string;
}
interface ContractJoinRow {
  id: number;
  contract_no: string;
  buyer_id: number;
  incoterm: string | null;
}
interface BuyerJoinRow {
  id: number;
  name: string;
  country_code: string | null;
}
interface LineAggRow {
  shipment_id: number;
  bags: number | string;
  net_kg: number | string;
}

/**
 * The shipment board: every consignment, newest first, with its line/bag totals and
 * how many of its five docs are live. The header enrichment (contract no, consignee)
 * comes from the S1 contract + buyer tables.
 */
export const getShipments = cache(async (): Promise<ShipmentRow[]> => {
  const sb = await getSupabase();
  const [ships, contracts, buyers, lines, docs] = await Promise.all([
    sb
      .from("export_shipments")
      .select(
        "id, contract_id, shipment_no, port_of_loading, bag_weight_kg, status, departed_at, created_at",
      )
      .order("created_at", { ascending: false }),
    sb.from("sales_contracts").select("id, contract_no, buyer_id, incoterm"),
    sb.from("b2b_buyers").select("id, name, country_code"),
    sb.from("export_shipment_lines").select("shipment_id, bags, net_kg"),
    sb.from("export_documents").select("shipment_id").is("superseded_by", null),
  ]);

  if (ships.error) throw new Error(`getShipments: ${ships.error.message}`);
  if (contracts.error) throw new Error(`getShipments(contracts): ${contracts.error.message}`);
  if (buyers.error) throw new Error(`getShipments(buyers): ${buyers.error.message}`);
  if (lines.error) throw new Error(`getShipments(lines): ${lines.error.message}`);
  if (docs.error) throw new Error(`getShipments(docs): ${docs.error.message}`);

  const contractById = new Map<number, ContractJoinRow>(
    (contracts.data as ContractJoinRow[]).map((c) => [c.id, c]),
  );
  const buyerById = new Map<number, BuyerJoinRow>(
    (buyers.data as BuyerJoinRow[]).map((b) => [b.id, b]),
  );

  const lineAgg = new Map<number, { bags: number; netKg: number; count: number }>();
  for (const l of lines.data as LineAggRow[]) {
    const a = lineAgg.get(l.shipment_id) ?? { bags: 0, netKg: 0, count: 0 };
    a.bags += n(l.bags);
    a.netKg += n(l.net_kg);
    a.count += 1;
    lineAgg.set(l.shipment_id, a);
  }

  const issuedByShipment = new Map<number, number>();
  for (const d of docs.data as { shipment_id: number }[]) {
    issuedByShipment.set(d.shipment_id, (issuedByShipment.get(d.shipment_id) ?? 0) + 1);
  }

  return (ships.data as ShipmentTableRow[]).map((s) => {
    const contract = contractById.get(s.contract_id) ?? null;
    const buyer = contract ? buyerById.get(contract.buyer_id) ?? null : null;
    const agg = lineAgg.get(s.id) ?? { bags: 0, netKg: 0, count: 0 };
    return {
      id: s.id,
      shipmentNo: s.shipment_no,
      contractId: s.contract_id,
      contractNo: contract?.contract_no ?? null,
      buyerName: buyer?.name ?? null,
      countryCode: buyer?.country_code ?? null,
      incoterm: contract?.incoterm ?? null,
      portOfLoading: s.port_of_loading,
      bagWeightKg: n(s.bag_weight_kg),
      status: asStatus(s.status),
      totalBags: agg.bags,
      totalNetKg: agg.netKg,
      lineCount: agg.count,
      issuedCount: issuedByShipment.get(s.id) ?? 0,
      departedAt: s.departed_at,
      createdAt: s.created_at,
    };
  });
});

interface ReadinessViewRow {
  shipment_id: number;
  doc_kind: string;
  issued: boolean;
  live_doc_id: number | null;
  unmet_prereqs: string[] | null;
}
interface LineViewRow {
  id: number;
  contract_line_id: number;
  green_lot_code: string;
  bags: number | string;
  net_kg: number | string;
}
interface DocPackViewRow {
  doc_id: number;
  doc_kind: string;
  doc_no: string;
  issued_at: string;
  payload: Record<string, unknown> | null;
}
interface ContractLineRow {
  id: number;
  green_lot_code: string;
  kg: number | string;
}

/**
 * The full detail payload for one shipment, keyed by its public `shipment_no`. Returns
 * null when no shipment carries that number (the page 404s — never a fabricated
 * consignment). Readiness is normalized to ALL five doc kinds in `DOC_KINDS` order so
 * the traffic-light grid always renders five tiles, even on a brand-new shipment.
 */
export const getShipment = cache(
  async (shipmentNo: string): Promise<ShipmentDetail | null> => {
    const sb = await getSupabase();

    const { data: shipRow, error: shipErr } = await sb
      .from("export_shipments")
      .select(
        "id, contract_id, shipment_no, port_of_loading, bag_weight_kg, status, departed_at, created_at",
      )
      .eq("shipment_no", shipmentNo)
      .maybeSingle();
    if (shipErr) throw new Error(`getShipment: ${shipErr.message}`);
    if (!shipRow) return null;

    const ship = shipRow as ShipmentTableRow;

    const [readyRes, linesRes, docsRes, contractRes] = await Promise.all([
      sb
        .from("v_export_pack_readiness")
        .select("shipment_id, doc_kind, issued, live_doc_id, unmet_prereqs")
        .eq("shipment_id", ship.id),
      sb
        .from("export_shipment_lines")
        .select("id, contract_line_id, green_lot_code, bags, net_kg")
        .eq("shipment_id", ship.id)
        .order("id"),
      sb
        .from("v_export_doc_pack")
        .select("doc_id, doc_kind, doc_no, issued_at, payload")
        .eq("shipment_id", ship.id)
        .order("issued_at", { ascending: false }),
      sb
        .from("sales_contracts")
        .select("id, contract_no, buyer_id, incoterm")
        .eq("id", ship.contract_id)
        .maybeSingle(),
    ]);

    if (readyRes.error) throw new Error(`getShipment(readiness): ${readyRes.error.message}`);
    if (linesRes.error) throw new Error(`getShipment(lines): ${linesRes.error.message}`);
    if (docsRes.error) throw new Error(`getShipment(docs): ${docsRes.error.message}`);
    if (contractRes.error) throw new Error(`getShipment(contract): ${contractRes.error.message}`);

    const contract = (contractRes.data as ContractJoinRow | null) ?? null;
    let buyer: BuyerJoinRow | null = null;
    if (contract) {
      const { data: buyerRow } = await sb
        .from("b2b_buyers")
        .select("id, name, country_code")
        .eq("id", contract.buyer_id)
        .maybeSingle();
      buyer = (buyerRow as BuyerJoinRow | null) ?? null;
    }

    const lines: ShipmentLineRow[] = (linesRes.data as LineViewRow[]).map((l) => ({
      id: l.id,
      contractLineId: l.contract_line_id,
      greenLotCode: l.green_lot_code,
      bags: n(l.bags),
      netKg: n(l.net_kg),
    }));

    const totalBags = lines.reduce((acc, l) => acc + l.bags, 0);
    const totalNetKg = lines.reduce((acc, l) => acc + l.netKg, 0);

    const issuedDocs: IssuedDoc[] = (docsRes.data as DocPackViewRow[])
      .map((d) => {
        const kind = asDocKind(d.doc_kind);
        return kind
          ? {
              docId: d.doc_id,
              docKind: kind,
              docNo: d.doc_no,
              issuedAt: d.issued_at,
              payload: d.payload,
            }
          : null;
      })
      .filter((d): d is IssuedDoc => d !== null);

    // Normalize readiness to all five kinds in canonical order.
    const readyByKind = new Map<DocKind, ReadinessViewRow>();
    for (const r of readyRes.data as ReadinessViewRow[]) {
      const kind = asDocKind(r.doc_kind);
      if (kind) readyByKind.set(kind, r);
    }
    const readiness: DocReadiness[] = DOC_KINDS.map((kind) => {
      const r = readyByKind.get(kind);
      return {
        docKind: kind,
        issued: r?.issued ?? false,
        liveDocId: r?.live_doc_id ?? null,
        unmetPrereqs: r?.unmet_prereqs ?? [],
      };
    });

    // Loadable lines: the contract's lines not already loaded onto this shipment.
    let loadableLines: LoadableLine[] = [];
    if (ship.status === "building") {
      const { data: clRows, error: clErr } = await sb
        .from("contract_lines")
        .select("id, green_lot_code, kg")
        .eq("contract_id", ship.contract_id)
        .order("id");
      if (clErr) throw new Error(`getShipment(contractLines): ${clErr.message}`);
      const loaded = new Set(lines.map((l) => l.contractLineId));
      loadableLines = (clRows as ContractLineRow[])
        .filter((c) => !loaded.has(c.id))
        .map((c) => ({ contractLineId: c.id, greenLotCode: c.green_lot_code, kg: n(c.kg) }));
    }

    const shipment: ShipmentRow = {
      id: ship.id,
      shipmentNo: ship.shipment_no,
      contractId: ship.contract_id,
      contractNo: contract?.contract_no ?? null,
      buyerName: buyer?.name ?? null,
      countryCode: buyer?.country_code ?? null,
      incoterm: contract?.incoterm ?? null,
      portOfLoading: ship.port_of_loading,
      bagWeightKg: n(ship.bag_weight_kg),
      status: asStatus(ship.status),
      totalBags,
      totalNetKg,
      lineCount: lines.length,
      issuedCount: issuedDocs.length,
      departedAt: ship.departed_at,
      createdAt: ship.created_at,
    };

    return { shipment, readiness, lines, issuedDocs, loadableLines };
  },
);

/**
 * Contracts a shipment can be built from: anything past 'draft' / 'cancelled' (a
 * signed/fixed contract has a reserved lot to load). The build form's picker.
 */
export const getBuildableContracts = cache(
  async (): Promise<BuildableContract[]> => {
    const sb = await getSupabase();
    const [contracts, buyers] = await Promise.all([
      sb
        .from("sales_contracts")
        .select("id, contract_no, buyer_id, incoterm, status")
        .not("status", "in", "(draft,cancelled)")
        .order("contract_no"),
      sb.from("b2b_buyers").select("id, name"),
    ]);
    if (contracts.error) throw new Error(`getBuildableContracts: ${contracts.error.message}`);
    if (buyers.error) throw new Error(`getBuildableContracts(buyers): ${buyers.error.message}`);

    const buyerById = new Map<number, string>(
      (buyers.data as { id: number; name: string }[]).map((b) => [b.id, b.name]),
    );

    return (
      contracts.data as {
        id: number;
        contract_no: string;
        buyer_id: number;
        incoterm: string | null;
        status: string;
      }[]
    ).map((c) => ({
      contractId: c.id,
      contractNo: c.contract_no,
      buyerName: buyerById.get(c.buyer_id) ?? null,
      incoterm: c.incoterm,
      status: c.status,
    }));
  },
);
