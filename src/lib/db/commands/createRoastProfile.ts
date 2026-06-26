import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for authoring a DRAFT roast profile (P3-S10 — roasting; ADR-002
 * — all writes flow through a SECURITY DEFINER command RPC). The single write door is
 * `create_roast_profile` — tenant-clamped, idempotent on a tenant-qualified key. A
 * profile is the versioned golden-curve target; a re-author of the same name mints the
 * NEXT version in the DB (versioning, never mutation). The profile is born 'draft';
 * `lock_roast_profile` makes it golden one-way.
 *
 * Symmetric twin of the read ports: a pure validator (mirrors the roast_level /
 * coffee_variety enums + the `> 0` temp/time CHECKs + the 0–100 DTR) plus a thin
 * command that calls the single `.rpc()` it needs (the `CreateRoastProfileStore` port),
 * testable against a fake store with no database. The variety + DTR are OPTIONAL (blank
 * forwards null — a house style spans varieties, DTR is an optional target); the
 * idempotency key is REQUIRED.
 */

/** The `roast_level` enum (P3-S6) — light→dark. */
export const ROAST_LEVELS = [
  "light",
  "medium-light",
  "medium",
  "medium-dark",
  "dark",
] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

/** The `coffee_variety` enum — the nullable variety a profile may target. */
export const ROAST_VARIETIES = [
  "Geisha",
  "Caturra",
  "Catuaí",
  "Pacamara",
  "Typica",
] as const;
export type RoastVariety = (typeof ROAST_VARIETIES)[number];

/** Validated, domain-shaped create-profile args (camelCase). */
export interface CreateRoastProfileInput {
  name: string;
  /** Target variety; null ⇒ a house style spanning varieties (nullable column). */
  variety: RoastVariety | null;
  roastLevel: RoastLevel;
  /** Charge temp (°C, > 0). */
  targetChargeTempC: number;
  /** Drop temp (°C, > 0). */
  targetDropTempC: number;
  /** Total roast time (s, > 0). */
  targetTotalTimeS: number;
  /** Development-time ratio target (%, 0–100); null ⇒ not declared. */
  targetDtrPct: number | null;
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

function isRoastLevel(v: string): v is RoastLevel {
  return (ROAST_LEVELS as readonly string[]).includes(v);
}

function isRoastVariety(v: string): v is RoastVariety {
  return (ROAST_VARIETIES as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw create-profile request — mirrors the `roast_profiles`
 * constraints (the roast_level / coffee_variety enums, `target_*_temp_c > 0`,
 * `target_total_time_s > 0`, `target_dtr_pct` 0–100) so errors surface before the
 * round-trip. The tenant clamp + version auto-increment are the RPC's job (ADR-002).
 */
export function validateCreateRoastProfile(
  raw: Record<string, unknown>,
): ValidationResult<CreateRoastProfileInput> {
  const errors: Record<string, string> = {};

  const name = trimmed(raw.name);
  if (!name) errors.name = "Name the roast profile.";

  // variety: optional (nullable column); blank ⇒ null, else must be a known variety.
  let variety: RoastVariety | null = null;
  if (!isBlank(raw.variety)) {
    const v = trimmed(raw.variety);
    if (!isRoastVariety(v)) errors.variety = "Choose a valid variety.";
    else variety = v;
  }

  const rawLevel = trimmed(raw.roastLevel);
  if (!rawLevel) errors.roastLevel = "Choose a roast level.";
  else if (!isRoastLevel(rawLevel)) errors.roastLevel = "Choose a valid roast level.";

  const targetChargeTempC = toNumber(raw.targetChargeTempC);
  if (targetChargeTempC === null || targetChargeTempC <= 0) {
    errors.targetChargeTempC = "Charge temp (°C) must be greater than 0.";
  }

  const targetDropTempC = toNumber(raw.targetDropTempC);
  if (targetDropTempC === null || targetDropTempC <= 0) {
    errors.targetDropTempC = "Drop temp (°C) must be greater than 0.";
  }

  const targetTotalTimeS = toNumber(raw.targetTotalTimeS);
  if (targetTotalTimeS === null || targetTotalTimeS <= 0) {
    errors.targetTotalTimeS = "Total roast time (s) must be greater than 0.";
  }

  // DTR: optional; if supplied must be within 0–100.
  let targetDtrPct: number | null = null;
  if (!isBlank(raw.targetDtrPct)) {
    const d = toNumber(raw.targetDtrPct);
    if (d === null || d < 0 || d > 100) {
      errors.targetDtrPct = "Development-time ratio must be between 0 and 100.";
    } else {
      targetDtrPct = d;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      variety,
      roastLevel: rawLevel as RoastLevel,
      targetChargeTempC: targetChargeTempC as number,
      targetDropTempC: targetDropTempC as number,
      targetTotalTimeS: targetTotalTimeS as number,
      targetDtrPct,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint profile id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `create_roast_profile` needs. */
export interface CreateRoastProfileStore {
  rpc(
    fn: "create_roast_profile",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the new profile's id, or friendly/labelled errors. */
export type CreateRoastProfileResult =
  | { ok: true; profileId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `create_roast_profile` onto a family-readable
 * sentence — the validator catches bad enums before the round-trip, but a defensive
 * cast failure (invalid_text_representation) or any other failure must never leak raw
 * PG text (errcodes, enum names). Always returns a clean sentence.
 */
export function friendlyCreateRoastProfileError(error: {
  message: string;
  code?: string;
}): string {
  const m = error.message.toLowerCase();
  if (error.code === "22P02" || m.includes("invalid input value for enum")) {
    return "Choose a valid roast level and variety, then try again.";
  }
  return "This roast profile couldn't be created right now. Please check the details and try again.";
}

/**
 * Validate then create: calls `create_roast_profile` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); an RPC failure
 * surfaces as a clean, family-readable sentence (raw Postgres text never leaks).
 * Exactly-once on `idempotencyKey` — a replay returns the same profile id.
 */
export async function createRoastProfile(
  store: CreateRoastProfileStore,
  raw: Record<string, unknown>,
): Promise<CreateRoastProfileResult> {
  const parsed = validateCreateRoastProfile(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_roast_profile", {
    p_name: parsed.data.name,
    p_variety: parsed.data.variety,
    p_roast_level: parsed.data.roastLevel,
    p_target_charge_temp_c: parsed.data.targetChargeTempC,
    p_target_drop_temp_c: parsed.data.targetDropTempC,
    p_target_total_time_s: parsed.data.targetTotalTimeS,
    p_target_dtr_pct: parsed.data.targetDtrPct,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: friendlyCreateRoastProfileError(error) };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This roast profile couldn't be created right now. Please try again.",
    };
  }
  return { ok: true, profileId: Number(data) };
}
