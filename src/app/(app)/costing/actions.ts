"use server";

import { revalidatePath } from "next/cache";

import { getSupabase } from "@/lib/supabase/server";

/**
 * S7 costing WRITE port — `bookCostEntry`: the first cost the owner appends to
 * the `cost_entry` ledger from the /costing UI (until now costs were demo-seeded
 * only). Server Actions are the driving port (ADR-002 — only ever invoked by an
 * authenticated human submitting a form), so this validates the row shape the DB
 * CHECK constraints enforce BEFORE touching the network, INSERTs the one legal
 * append (the table grants INSERT-only to `authenticated`; UPDATE/DELETE are
 * physically blocked by the immutability trigger), then calls `refresh_lot_cost`
 * so the matview-backed cost-per-kg-green reflects the new entry immediately
 * (the same write-path seam the migration documents).
 *
 * SCOPE: booking NEW originals only (amount_usd >= 0). A correction is a
 * REVERSING entry (negative amount + reverses_id) — out of scope here; see the
 * follow-up note in page.tsx / the slice report. We deliberately do NOT accept
 * `reverses_id` so the UI cannot post a reversal by accident.
 */

const DRIVERS = ["worker-day", "task", "processing-batch"] as const;
const ALLOCATION_RULES = [
  "direct-labor",
  "processing",
  "agronomy",
  "overhead",
] as const;
const TARGET_KINDS = ["plot", "lot", "farm"] as const;

export type CostDriver = (typeof DRIVERS)[number];
export type AllocationRule = (typeof ALLOCATION_RULES)[number];
export type CostTargetKind = (typeof TARGET_KINDS)[number];

/** The input the form hands the action (camelCase; `targetCode`/`memo` optional). */
export interface BookCostEntryInput {
  driver: CostDriver;
  allocationRule: AllocationRule;
  targetKind: CostTargetKind;
  /** plots.id (plot) | lots.code (lot) | blank/absent for farm. */
  targetCode?: string;
  /** an ORIGINAL entry must be >= 0 (a reversal is the only negative path). */
  amountUsd: number;
  memo?: string;
}

export type BookCostEntryResult = { ok: true } | { ok: false; error: string };

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** snake_case ledger row the action inserts (the one legal append). */
interface CostEntryInsert {
  driver: string;
  allocation_rule: string;
  target_kind: string;
  target_code: string | null;
  amount_usd: number;
  memo: string | null;
}

/** Validate the shape the DB CHECKs enforce, returning a clean message on a violation. */
function validate(
  input: BookCostEntryInput,
): { ok: true; row: CostEntryInsert } | { ok: false; error: string } {
  const { driver, allocationRule, targetKind, amountUsd } = input;

  if (!DRIVERS.includes(driver as CostDriver)) {
    return { ok: false, error: `Unknown driver: ${String(driver)}.` };
  }
  if (!ALLOCATION_RULES.includes(allocationRule as AllocationRule)) {
    return {
      ok: false,
      error: `Unknown allocation rule: ${String(allocationRule)}.`,
    };
  }
  if (!TARGET_KINDS.includes(targetKind as CostTargetKind)) {
    return { ok: false, error: `Unknown target kind: ${String(targetKind)}.` };
  }

  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd)) {
    return { ok: false, error: "Amount must be a number." };
  }
  if (amountUsd < 0) {
    return {
      ok: false,
      error: "Amount must be at least 0 — corrections post as a reversing entry.",
    };
  }

  // Shape guard mirroring the DB CHECK: a farm row carries NO target; a
  // plot/lot row MUST name one.
  const code = trimmed(input.targetCode);
  if (targetKind === "farm") {
    if (code) {
      return {
        ok: false,
        error: "A farm-wide cost carries no target — clear the target code.",
      };
    }
  } else if (!code) {
    return {
      ok: false,
      error: `A ${targetKind} cost requires a target code.`,
    };
  }

  return {
    ok: true,
    row: {
      driver,
      allocation_rule: allocationRule,
      target_kind: targetKind,
      target_code: targetKind === "farm" ? null : code,
      amount_usd: amountUsd,
      memo: trimmed(input.memo) || null,
    },
  };
}

export async function bookCostEntry(
  input: BookCostEntryInput,
): Promise<BookCostEntryResult> {
  const parsed = validate(input);
  if (!parsed.ok) return parsed;

  const sb = await getSupabase();

  const { error } = await sb.from("cost_entry").insert(parsed.row);
  if (error) return { ok: false, error: error.message };

  // Bust the matview cache so the new cost is reflected immediately (D5 — the
  // write-path refresh seam). Best-effort: the append is the source of truth, so
  // a refresh hiccup must not fail the booking (the next refresh/read recovers).
  await sb.rpc("refresh_lot_cost");

  revalidatePath("/costing");
  return { ok: true };
}
