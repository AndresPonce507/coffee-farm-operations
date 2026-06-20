import { getSupabase } from "@/lib/supabase/server";
import type { AttendanceStatus, Worker, WorkerRole } from "@/lib/types";

export interface WorkerRow {
  id: string;
  name: string;
  role: WorkerRole;
  daily_rate_usd: number | string;
  attendance: AttendanceStatus;
  started_year: number;
  phone: string;
  today_kg: number | string;
  crew: string;
}

export function mapWorker(r: WorkerRow): Worker {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    dailyRateUsd: Number(r.daily_rate_usd),
    attendance: r.attendance,
    startedYear: Number(r.started_year),
    phone: r.phone,
    todayKg: Number(r.today_kg),
    crew: r.crew,
  };
}

export async function getWorkers(): Promise<Worker[]> {
  const { data, error } = await getSupabase()
    .from("workers")
    .select("*")
    .order("id");
  if (error) throw new Error(`getWorkers: ${error.message}`);
  return (data as WorkerRow[]).map(mapWorker);
}

/** Pickers only — mirrors the `pickers` export from the mock data. */
export async function getPickers(): Promise<Worker[]> {
  const { data, error } = await getSupabase()
    .from("workers")
    .select("*")
    .eq("role", "Picker")
    .order("id");
  if (error) throw new Error(`getPickers: ${error.message}`);
  return (data as WorkerRow[]).map(mapWorker);
}
