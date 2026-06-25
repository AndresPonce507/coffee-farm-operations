"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";
import { DOC_KINDS, type DocKind } from "./data";

/**
 * /sales/shipments WRITE port — the export-doc-pack Server Actions (P3-S3).
 *
 * Server Actions are the one driving port (rail §7, the injection invariant): only ever
 * invoked by an authenticated human submitting a form, never by untrusted inbound. Each
 * validates the shape the DB enforces BEFORE the network hop, then appends through a
 * single SECURITY DEFINER command RPC:
 *   • build_export_shipment — mints the JC-S-NNNN consignment for a contract.
 *   • add_shipment_line     — inserts a lot_shipments CLAIM first (the EXISTING
 *     prevent_oversell trigger fires there — no parallel counter), then the line;
 *     this is the green-inventory / ATP-moving write.
 *   • issue_export_doc      — THE GATED WRITER. The database evaluates the declarative
 *     export_doc_prereqs against LIVE state and raises with the EXACT unmet list when a
 *     prerequisite is missing (auditor-honest, never a blank doc). These author-written
 *     guard messages are family-readable, so they pass through VERBATIM; structural
 *     Postgres errors map to clean copy — never a raw SQLSTATE leak.
 *
 * REVALIDATION: add_shipment_line commits a lot_shipments row (green inventory / ATP
 * moves), so it fans out through reactiveRefresh, the RIPPLE SSOT (never a hand-rolled
 * revalidatePath — the ripple-actions-wired guard). build/issue move no green inventory
 * — the document grid refreshes client-side (router.refresh) after a successful write.
 *
 * WIRING SEAM (out of this slice's file scope — src/lib/revalidate.ts is a shared
 * contract file the Wiring pass owns): add_shipment_line currently rides the existing
 * "inventory-update" kind (ATP is green inventory). Wiring should add a dedicated
 * "export-doc-issued" / "shipment-line" EventKind whose RIPPLE routes include
 * /sales/shipments + /sales/shipments/[no] + /lots/[code], register this action file in
 * the guard's KIND_TO_ACTION_FILES, and repoint these calls.
 */

export interface BuildShipmentInput {
  contractId: number;
  portOfLoading: string;
  bagWeightKg: number;
  idempotencyKey: string;
}

export interface AddShipmentLineInput {
  shipmentId: number;
  contractLineId: number;
  bags: number;
  idempotencyKey: string;
}

export interface IssueDocInput {
  shipmentId: number;
  docKind: string;
  idempotencyKey: string;
}

export type BuildShipmentResult =
  | { ok: true; shipmentId: number }
  | { ok: false; error: string };

export type AddLineResult =
  | { ok: true; lineId: number }
  | { ok: false; error: string };

export type IssueDocResult =
  | { ok: true; docId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. The SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (the prereq gate's exact unmet list, the
 * oversell guard, status guards) — all safe and clear, so they pass through verbatim.
 * Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, t: (k: string) => string): string {
  switch (error.code) {
    case "23514": // check_violation — the gate's exact unmet list, oversell, status guard
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown contract / shipment / line")
      return error.message;
    case "42501": // insufficient_privilege
      return t("errors.access");
    case "23505": // unique_violation — idempotent replay collided
      return t("errors.duplicate");
    default:
      return t("errors.generic");
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

export async function buildExportShipmentAction(
  input: BuildShipmentInput,
): Promise<BuildShipmentResult> {
  const t = await getTranslations("shipments");
  if (!isPositiveInt(input.contractId)) {
    return { ok: false, error: t("errors.contractRequired") };
  }
  if (!isPositive(input.bagWeightKg)) {
    return { ok: false, error: t("errors.bagWeightPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("build_export_shipment", {
    p_contract_id: input.contractId,
    p_port_of_loading: input.portOfLoading?.trim() || "Balboa, PA",
    p_bag_weight_kg: input.bagWeightKg,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { ok: false, error: friendlyError(error as PgError, t) };
  return { ok: true, shipmentId: Number(data) };
}

export async function addShipmentLineAction(
  input: AddShipmentLineInput,
): Promise<AddLineResult> {
  const t = await getTranslations("shipments");
  if (!isPositiveInt(input.shipmentId)) {
    return { ok: false, error: t("errors.shipmentRequired") };
  }
  if (!isPositiveInt(input.contractLineId)) {
    return { ok: false, error: t("errors.lineRequired") };
  }
  if (!isPositiveInt(input.bags)) {
    return { ok: false, error: t("errors.bagsPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("add_shipment_line", {
    p_shipment_id: input.shipmentId,
    p_contract_line_id: input.contractLineId,
    p_bags: input.bags,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { ok: false, error: friendlyError(error as PgError, t) };

  // add_shipment_line inserted a lot_shipments row: green inventory / ATP moved.
  reactiveRefresh("inventory-update");
  return { ok: true, lineId: Number(data) };
}

export async function issueExportDocAction(
  input: IssueDocInput,
): Promise<IssueDocResult> {
  const t = await getTranslations("shipments");
  if (!isPositiveInt(input.shipmentId)) {
    return { ok: false, error: t("errors.shipmentRequired") };
  }
  if (!DOC_KINDS.includes(input.docKind as DocKind)) {
    return { ok: false, error: t("errors.docRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("issue_export_doc", {
    p_shipment_id: input.shipmentId,
    p_doc_kind: input.docKind,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { ok: false, error: friendlyError(error as PgError, t) };
  return { ok: true, docId: Number(data) };
}
