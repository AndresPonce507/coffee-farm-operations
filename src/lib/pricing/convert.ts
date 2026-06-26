/**
 * P3-S0 · lb↔kg / $/lb↔$/kg helpers — the PURE, DB-free mirror of the unit
 * conversion the pricing core uses. The DATABASE is the source of truth: the
 * `units` table seeds the avoirdupois pound as `('[lb]','mass',0.453592,'lb')`
 * and `convert_qty(qty, from, to) = qty * to_base(from) / to_base(to)`
 * (migration 20260621092000_event_log_units_lot_graph.sql). The commodity "C"
 * price is $/lb; the pricing RPC turns it into $/kg via
 * `(price) × convert_qty(1,'kg','[lb]')` — i.e. `price / 0.453592` — NEVER a
 * hardcoded 2.2046 literal (the named silent-corruption trap).
 *
 * These helpers exist for client-side DISPLAY / pre-flight validation only; the
 * DB remains authoritative. Every conversion derives from the single named
 * constant below, so a calibration change is one edit and the client can never
 * silently diverge from `convert_qty`. Pure functions only — no Supabase, no React.
 */

/**
 * Kilograms per avoirdupois pound — the SINGLE source-of-truth factor, IDENTICAL
 * to the seeded `units` row `('[lb]','mass',0.453592,…)` (the DB `to_base` for
 * `[lb]`). NEVER write `2.2046` (or `1/0.453592`) as a magic literal anywhere
 * else; derive it from this constant.
 */
export const LB_TO_KG = 0.453592;

/**
 * The seeded mass-dimension `to_base` factors, mirroring the `units` table rows
 * (kg = 1 base; g = 0.001; [lb] = LB_TO_KG). Used by `convertMass` to mirror
 * `convert_qty` over the mass dimension.
 */
export const MASS_TO_BASE_KG: Readonly<Record<string, number>> = {
  kg: 1,
  g: 0.001,
  "[lb]": LB_TO_KG,
};

/** Pounds → kilograms: `lb × 0.453592`. Mirrors `convert_qty(lb,'[lb]','kg')`. */
export function lbToKg(lb: number): number {
  return lb * LB_TO_KG;
}

/**
 * Kilograms → pounds: `kg / 0.453592` — exactly `convert_qty(kg,'kg','[lb]')`.
 * Derived from `LB_TO_KG`, never a typed 2.2046.
 */
export function kgToLb(kg: number): number {
  return kg / LB_TO_KG;
}

/**
 * $/lb → $/kg: `usdPerLb / 0.453592` — exactly the pricing RPC's
 * `(price) × convert_qty(1,'kg','[lb]')`. Derived from `LB_TO_KG`.
 */
export function usdPerLbToUsdPerKg(usdPerLb: number): number {
  return usdPerLb / LB_TO_KG;
}

/** $/kg → $/lb: `usdPerKg × 0.453592` — the exact inverse of `usdPerLbToUsdPerKg`. */
export function usdPerKgToUsdPerLb(usdPerKg: number): number {
  return usdPerKg * LB_TO_KG;
}

/**
 * A faithful client mirror of `convert_qty` over the MASS dimension only:
 * `qty * to_base(from) / to_base(to)`. Returns `null` for an unknown mass unit
 * (fails loud, never a silent 0 — the same D8 posture as the DB function, which
 * returns NULL for an unknown unit or a cross-dimension request). Only the seeded
 * mass units (`kg`, `g`, `[lb]`) are known here; anything else ⇒ null.
 */
export function convertMass(
  qty: number,
  fromUnit: string,
  toUnit: string,
): number | null {
  const from = MASS_TO_BASE_KG[fromUnit];
  const to = MASS_TO_BASE_KG[toUnit];
  if (from == null || to == null) return null;
  return (qty * from) / to;
}
