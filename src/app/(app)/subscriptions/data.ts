import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /subscriptions read port (P3-S12 Reserve Club subscriptions).
 *
 * Co-located with the route: it binds DIRECTLY to the authoritative SQL surface the
 * P3-S12 migration shipped — the `v_subscription_board` security_invoker view — plus
 * the Phase-1 `green_lots_atp` view for the allocate picker. A sibling `@/lib/db`
 * port may land later; importing a not-yet-existent module hard-fails Vite, so this
 * stays local until the Wiring pass collapses it.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`. The
 * allocation board reads the ATP a scarce micro-lot has left, so the operator can see
 * how many kg are still free to promise BEFORE allocating a cycle (the allocate RPC
 * inserts a lot_reservations row and the EXISTING prevent_oversell trigger is the real
 * wall — this is a courtesy read, rail §4).
 */

export type SubCadence = "monthly" | "bi-monthly" | "quarterly";
export type SubStatus = "active" | "paused" | "past_due" | "cancelled";

/** One row of `v_subscription_board` — a recurring box with its allocation state. */
export interface SubscriptionRow {
  id: number;
  cadence: SubCadence;
  status: SubStatus;
  customerEmail: string | null;
  customerName: string | null;
  allocatedKg: number;
  dunningCount: number;
  startedAt: string;
}

/** One allocatable green lot — code, grade, and kg still available-to-promise. */
export interface AllocatableLot {
  greenLotCode: string;
  scaGrade: string | null;
  atpKg: number;
}

interface SubscriptionBoardViewRow {
  id: number | string;
  cadence: string;
  status: string;
  customer_email: string | null;
  customer_name: string | null;
  allocated_kg: number | string | null;
  dunning_count: number | string | null;
  started_at: string;
}

interface AtpViewRow {
  green_lot_code: string;
  sca_grade: string | null;
  atp: number | string | null;
}

const i = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

/** Every subscription, newest first, with allocated kg + dunning count. */
export const getSubscriptionBoard = cache(
  async (): Promise<SubscriptionRow[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_subscription_board")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) throw new Error(`getSubscriptionBoard: ${error.message}`);
    return (data as SubscriptionBoardViewRow[]).map((r) => ({
      id: i(r.id),
      cadence: r.cadence as SubCadence,
      status: r.status as SubStatus,
      customerEmail: r.customer_email,
      customerName: r.customer_name,
      allocatedKg: i(r.allocated_kg),
      dunningCount: i(r.dunning_count),
      startedAt: r.started_at,
    }));
  },
);

/** Green lots with ATP left, for the allocate picker. Only lots with kg free show. */
export const getAllocatableLots = cache(async (): Promise<AllocatableLot[]> => {
  const { data, error } = await (await getSupabase())
    .from("green_lots_atp")
    .select("green_lot_code, sca_grade, atp")
    .order("green_lot_code", { ascending: true });
  if (error) throw new Error(`getAllocatableLots: ${error.message}`);
  return (data as AtpViewRow[])
    .map((r) => ({
      greenLotCode: r.green_lot_code,
      scaGrade: r.sca_grade,
      atpKg: i(r.atp),
    }))
    .filter((l) => l.atpKg > 0);
});
