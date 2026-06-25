import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S3 — Export shipments + export-doc-pack READ-port (ADR-003           */
/* derived-read). THE HEADLINE SLICE. One consignment per contract         */
/* (`export_shipments`) loads contract lines (`export_shipment_lines`, each */
/* riding a `lot_shipments` claim so `prevent_oversell` guards physical     */
/* over-shipment) and issues the five mandated trade documents             */
/* (`export_documents`) — but ONLY when their prerequisites clear. The gate */
/* is auditable DATA (`export_doc_prereqs`), evaluated against live state   */
/* and surfaced through `v_export_pack_readiness` (the traffic-light        */
/* source) and `v_export_doc_pack` (the LIVE issued docs + frozen payloads, */
/* the PDF source). The only writers are the SECURITY DEFINER RPCs in the   */
/* command ports (`@/lib/db/commands/{buildExportShipment,addShipmentLine,  */
/* issueExportDoc}`); this port only READS. Mirrors the pricing.ts /        */
/* greenlots.ts shape: `Row` interface + pure `mapX` mapper + `cache()`'d   */
/* getters; NULLs (un-issued live doc, not-yet-departed shipment) are       */
/* PRESERVED, never fabricated. The frozen `payload` is the at-issue        */
/* snapshot the PDF reads — passed through UNCHANGED (NOT re-camelCased), so */
/* the legal document the family confirmed never silently re-shapes.        */
/* ====================================================================== */

/** The five mandated trade documents (the `export_doc_kind` enum). */
export type ExportDocKind =
  | "commercial_invoice"
  | "certificate_of_origin"
  | "phytosanitary"
  | "packing_list"
  | "bill_of_lading";

/** A consignment's lifecycle (`export_shipments.status`). */
export type ExportShipmentStatus =
  | "building"
  | "docs_issued"
  | "departed"
  | "arrived"
  | "closed";

/** A declarative prerequisite kind (`export_doc_prereqs.prereq_kind`). */
export type ExportPrereqKind = "contract_signed" | "eudr_compliant" | "doc_issued";

/** Coerce a nullable numeric (PostgREST may serialize numeric/bigint as a string)
 *  to a number, PRESERVING null — an un-issued live doc id stays null, never 0. */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- export_shipments ---------------- */

/** Shape of an `export_shipments` row as returned by PostgREST (snake_case). */
export interface ExportShipmentRow {
  id: number | string;
  contract_id: number | string;
  shipment_no: string;
  port_of_loading: string;
  bag_weight_kg: number | string;
  status: ExportShipmentStatus | string;
  departed_at: string | null;
  created_at: string;
}

/** One export consignment (a contract's shipment), status building→…→closed. */
export interface ExportShipment {
  id: number;
  contractId: number;
  shipmentNo: string;
  portOfLoading: string;
  bagWeightKg: number;
  status: ExportShipmentStatus | string;
  /** Wall-clock of departure; NULL until the shipment departs (never fabricated). */
  departedAt: string | null;
  createdAt: string;
}

/** Pure row → domain mapper for a shipment (numeric coercion; NULL departed_at
 *  preserved). */
export function mapExportShipment(r: ExportShipmentRow): ExportShipment {
  return {
    id: Number(r.id),
    contractId: Number(r.contract_id),
    shipmentNo: r.shipment_no,
    portOfLoading: r.port_of_loading,
    bagWeightKg: Number(r.bag_weight_kg),
    status: r.status,
    departedAt: r.departed_at,
    createdAt: r.created_at,
  };
}

/* ---------------- v_export_pack_readiness ---------------- */

/** Shape of a `v_export_pack_readiness` row (snake_case). `live_doc_id` is NULL
 *  when the doc has not been issued; `unmet_prereqs` is the auditor-honest array
 *  of unmet prerequisite labels (empty ⇒ clear to issue). */
export interface ExportPackReadinessRow {
  tenant_id: string;
  shipment_id: number | string;
  doc_kind: ExportDocKind | string;
  issued: boolean;
  live_doc_id: number | string | null;
  unmet_prereqs: string[] | null;
}

/** Per shipment × doc_kind: is there a live issued doc, and (if not) exactly which
 *  prerequisites are unmet — the traffic-light + inline-blocker source. */
export interface ExportPackReadiness {
  shipmentId: number;
  docKind: ExportDocKind | string;
  issued: boolean;
  /** The live issued doc's id, or NULL when not yet issued (never fabricated). */
  liveDocId: number | null;
  /** Auditor-honest unmet prerequisite labels; empty ⇒ clear to issue. */
  unmetPrereqs: string[];
}

/** Pure row → domain mapper for a readiness row (numeric coercion of the live doc
 *  id; a NULL prereq array degrades to []). */
export function mapPackReadiness(r: ExportPackReadinessRow): ExportPackReadiness {
  return {
    shipmentId: Number(r.shipment_id),
    docKind: r.doc_kind,
    issued: r.issued,
    liveDocId: num(r.live_doc_id),
    unmetPrereqs: r.unmet_prereqs ?? [],
  };
}

/* ---------------- v_export_doc_pack (frozen payload) ---------------- */

/** One loaded line inside a frozen export-doc payload snapshot (the at-issue shape
 *  the RPC minted — snake_case, deliberately NOT re-camelCased). */
export interface ExportDocPayloadLine {
  green_lot_code: string;
  bags: number;
  net_kg: number;
  /** The Phase-1 EUDR verdict snapshotted at issue ('compliant' for an issued CO). */
  eudr_status: string;
}

/** The frozen rendered snapshot stored on an issued `export_documents.payload`.
 *  It is the at-issue PDF source — read verbatim, never recomputed. */
export interface ExportDocPayload {
  doc_kind: string;
  shipment_no: string;
  port_of_loading: string;
  contract_no: string;
  incoterm: string;
  consignee: { name: string; country_code: string | null };
  issued_at: string;
  total_bags: number;
  total_net_kg: number;
  lines: ExportDocPayloadLine[];
}

/** Shape of a `v_export_doc_pack` row (snake_case) — a LIVE issued doc. */
export interface ExportDocPackRow {
  tenant_id: string;
  shipment_id: number | string;
  doc_id: number | string;
  doc_kind: ExportDocKind | string;
  doc_no: string;
  payload: ExportDocPayload;
  issued_at: string;
}

/** A LIVE issued export document + its frozen payload (the PDF source). */
export interface ExportDoc {
  shipmentId: number;
  docId: number;
  docKind: ExportDocKind | string;
  docNo: string;
  /** The frozen at-issue snapshot — passed through UNCHANGED (not re-shaped). */
  payload: ExportDocPayload;
  issuedAt: string;
}

/** Pure row → domain mapper for an issued doc. The frozen `payload` is passed
 *  through by reference — it is the legal at-issue snapshot, never recomputed. */
export function mapExportDoc(r: ExportDocPackRow): ExportDoc {
  return {
    shipmentId: Number(r.shipment_id),
    docId: Number(r.doc_id),
    docKind: r.doc_kind,
    docNo: r.doc_no,
    payload: r.payload,
    issuedAt: r.issued_at,
  };
}

/* ---------------- export_doc_prereqs (the declarative gate) ---------------- */

/** Shape of an `export_doc_prereqs` row (snake_case) — the auditable gate data. */
export interface ExportDocPrereqRow {
  id: number | string;
  doc_kind: ExportDocKind | string;
  prereq_label: string;
  prereq_kind: ExportPrereqKind | string;
  required_doc_kind: ExportDocKind | string | null;
  created_at: string;
}

/** One declarative prerequisite (the gate is auditable DATA, not buried code). */
export interface ExportDocPrereq {
  id: number;
  docKind: ExportDocKind | string;
  prereqLabel: string;
  prereqKind: ExportPrereqKind | string;
  /** The dependency doc for a 'doc_issued' prereq; NULL otherwise. */
  requiredDocKind: ExportDocKind | string | null;
  createdAt: string;
}

/** Pure row → domain mapper for a declarative prerequisite. */
export function mapExportDocPrereq(r: ExportDocPrereqRow): ExportDocPrereq {
  return {
    id: Number(r.id),
    docKind: r.doc_kind,
    prereqLabel: r.prereq_label,
    prereqKind: r.prereq_kind,
    requiredDocKind: r.required_doc_kind,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * Every export consignment (`export_shipments`), newest shipment_no first — the
 * `/sales/shipments` index source. RLS scopes the read to the caller's tenant.
 */
export const getExportShipments = cache(async (): Promise<ExportShipment[]> => {
  const { data, error } = await (await getSupabase())
    .from("export_shipments")
    .select("*")
    .order("shipment_no", { ascending: false });
  if (error) throw new Error(`getExportShipments: ${error.message}`);
  return (data as ExportShipmentRow[]).map(mapExportShipment);
});

/**
 * The export consignments for one contract (`export_shipments` filtered to a
 * contract) — the contract-workspace "shipments" panel source.
 */
export const getExportShipmentsByContract = cache(
  async (contractId: number): Promise<ExportShipment[]> => {
    const { data, error } = await (await getSupabase())
      .from("export_shipments")
      .select("*")
      .eq("contract_id", contractId)
      .order("shipment_no");
    if (error) {
      throw new Error(`getExportShipmentsByContract: ${error.message}`);
    }
    return (data as ExportShipmentRow[]).map(mapExportShipment);
  },
);

/**
 * One consignment by its minted `shipment_no` (`export_shipments` filtered), or
 * `null` when none exists yet (notFound() territory for `/sales/shipments/[no]`).
 */
export const getExportShipment = cache(
  async (shipmentNo: string): Promise<ExportShipment | null> => {
    const { data, error } = await (await getSupabase())
      .from("export_shipments")
      .select("*")
      .eq("shipment_no", shipmentNo);
    if (error) throw new Error(`getExportShipment: ${error.message}`);
    const rows = (data as ExportShipmentRow[] | null) ?? [];
    return rows.length > 0 ? mapExportShipment(rows[0]) : null;
  },
);

/**
 * The traffic-light readiness for a shipment (`v_export_pack_readiness`) — one row
 * per doc_kind (in enum order: commercial invoice · certificate of origin · phyto ·
 * packing list · B/L) carrying issued? / the exact unmet prerequisites. The
 * headline grid + inline-blocker source.
 */
export const getPackReadiness = cache(
  async (shipmentId: number): Promise<ExportPackReadiness[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_export_pack_readiness")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("doc_kind");
    if (error) throw new Error(`getPackReadiness: ${error.message}`);
    return (data as ExportPackReadinessRow[]).map(mapPackReadiness);
  },
);

/**
 * The LIVE issued documents for a shipment + their frozen payloads
 * (`v_export_doc_pack`) — the PDF pack source (superseded re-issues excluded by
 * the view).
 */
export const getExportDocPack = cache(
  async (shipmentId: number): Promise<ExportDoc[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_export_doc_pack")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("doc_kind");
    if (error) throw new Error(`getExportDocPack: ${error.message}`);
    return (data as ExportDocPackRow[]).map(mapExportDoc);
  },
);

/**
 * The declarative prerequisite gate (`export_doc_prereqs`) — global trade-rule
 * reference data (the same for every estate), exposed so the UI can render the
 * gate itself as auditable data, not buried code.
 */
export const getExportDocPrereqs = cache(
  async (): Promise<ExportDocPrereq[]> => {
    const { data, error } = await (await getSupabase())
      .from("export_doc_prereqs")
      .select("*")
      .order("doc_kind");
    if (error) throw new Error(`getExportDocPrereqs: ${error.message}`);
    return (data as ExportDocPrereqRow[]).map(mapExportDocPrereq);
  },
);
