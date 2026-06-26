/**
 * /sales/shipments pure type + constant surface (P3-S3 export shipments + doc pack).
 *
 * Server-free on purpose: the headline `doc-pack.client.tsx` island needs the runtime
 * doc-kind constants (`DOC_KINDS`, `ISSUE_ORDER`) and the row shapes. Those live here —
 * never in `data.ts`, which imports the server-only Supabase client (`next/headers`) and
 * would drag that into the client bundle (a hard webpack error). `data.ts` re-exports
 * everything below, so its public API is unchanged for the RSC/test callers.
 */

/** The five mandated trade documents, in the headline tile order (spec §231). */
export type DocKind =
  | "commercial_invoice"
  | "certificate_of_origin"
  | "phytosanitary"
  | "packing_list"
  | "bill_of_lading";

/** Tile display order: invoice · ICO origin · MIDA phyto · packing list · B/L. */
export const DOC_KINDS: readonly DocKind[] = [
  "commercial_invoice",
  "certificate_of_origin",
  "phytosanitary",
  "packing_list",
  "bill_of_lading",
] as const;

/**
 * Dependency-safe issue order for the one-click "Issue pack": a document that is a
 * prerequisite of another must be minted first. packing_list precedes phytosanitary
 * (phyto ⇐ packing list); the bill_of_lading is last (⇐ all four others — the
 * keystone). The database gate re-checks every prereq on each call regardless; this
 * ordering just lets the batch mint all five clear docs in a single sweep.
 */
export const ISSUE_ORDER: readonly DocKind[] = [
  "commercial_invoice",
  "certificate_of_origin",
  "packing_list",
  "phytosanitary",
  "bill_of_lading",
] as const;

export type ShipmentStatus =
  | "building"
  | "docs_issued"
  | "departed"
  | "arrived"
  | "closed";

/** A consignment header row (mirrors `export_shipments`, enriched with the contract). */
export interface ShipmentRow {
  id: number;
  shipmentNo: string;
  contractId: number;
  contractNo: string | null;
  buyerName: string | null;
  countryCode: string | null;
  incoterm: string | null;
  portOfLoading: string;
  bagWeightKg: number;
  status: ShipmentStatus;
  totalBags: number;
  totalNetKg: number;
  lineCount: number;
  /** number of LIVE issued docs (superseded_by IS NULL). */
  issuedCount: number;
  departedAt: string | null;
  createdAt: string;
}

/** One doc-kind's readiness (mirrors `v_export_pack_readiness`). */
export interface DocReadiness {
  docKind: DocKind;
  issued: boolean;
  liveDocId: number | null;
  /** EXACT unmet prerequisite labels from the database (empty ⇒ clear to issue). */
  unmetPrereqs: string[];
}

/** A loaded shipment line (mirrors `export_shipment_lines`). */
export interface ShipmentLineRow {
  id: number;
  contractLineId: number;
  greenLotCode: string;
  bags: number;
  netKg: number;
}

/** A LIVE issued document (mirrors `v_export_doc_pack`). */
export interface IssuedDoc {
  docId: number;
  docKind: DocKind;
  docNo: string;
  issuedAt: string;
  payload: Record<string, unknown> | null;
}

/** A contract line not yet loaded onto this shipment (the building picker). */
export interface LoadableLine {
  contractLineId: number;
  greenLotCode: string;
  kg: number;
}

/** Everything the headline detail page renders. */
export interface ShipmentDetail {
  shipment: ShipmentRow;
  /** readiness for ALL five doc kinds, in `DOC_KINDS` order. */
  readiness: DocReadiness[];
  lines: ShipmentLineRow[];
  issuedDocs: IssuedDoc[];
  loadableLines: LoadableLine[];
}

/** A contract that can have a shipment built from it (the index build form). */
export interface BuildableContract {
  contractId: number;
  contractNo: string;
  buyerName: string | null;
  incoterm: string | null;
  status: string;
}
