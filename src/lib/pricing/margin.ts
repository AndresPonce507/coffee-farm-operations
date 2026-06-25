/**
 * P3-S0 · Margin helpers — the PURE, DB-free mirror of the two distinct margin
 * numbers in the pricing core. The DATABASE is the source of truth:
 *   * the `_enforce_margin_floor` BEFORE-INSERT trigger rejects a quote whose
 *     usd price is below `cost × (1 + regime_floor_pct)` — a markup-ON-COST floor;
 *   * the GENERATED `price_quotes.margin_pct_at_quote` column reports
 *     `(usd_price − cost) / usd_price` — a margin-ON-REVENUE display number.
 * (both from migration 20260703090000_dual_regime_pricing.sql).
 *
 * THESE ARE TWO DIFFERENT NUMBERS BY DESIGN (Andres's markup-vs-margin trap):
 * a price sitting exactly on a 10% markup floor is ~9.09% margin-on-revenue, not
 * 10%. Ports/UI must never conflate `floorPrice`/`isBelowFloor` (markup-on-cost)
 * with `marginPct` (margin-on-revenue).
 *
 * NULL / non-positive COGS ⇒ "margin unknown" (allowed-but-flagged) — NEVER a
 * fabricated floor or a fake margin. Real `cogs_per_lot` is either NULL or
 * strictly positive, so the `<= 0` guard is a defensive superset of the DB that
 * never fires on real data. Pure functions only — no Supabase, no React.
 */

/** Reserve regime minimum margin floor — mirrors farm_season_config default. */
export const RESERVE_MIN_MARGIN_PCT = 0.2;
/** Commodity regime minimum margin floor — mirrors farm_season_config default. */
export const COMMODITY_MIN_MARGIN_PCT = 0.1;

/**
 * The same 1e-9 slack the `_enforce_margin_floor` trigger applies
 * (`usd_price < floor - 1e-9`) so floating-point dust never produces a false
 * "below floor" reject.
 */
export const MARGIN_FLOOR_EPSILON = 1e-9;

/** A usable (known) cost is a finite, strictly-positive number. */
function costIsKnown(cost: number | null | undefined): cost is number {
  return cost != null && Number.isFinite(cost) && cost > 0;
}

/**
 * The regime's minimum margin floor (markup-on-cost) — mirrors the trigger's
 * `case when regime = 'reserve' then reserve_min_margin_pct else commodity...`.
 */
export function minMarginPctForRegime(regime: "commodity" | "reserve"): number {
  return regime === "reserve" ? RESERVE_MIN_MARGIN_PCT : COMMODITY_MIN_MARGIN_PCT;
}

/**
 * DISPLAY margin-on-revenue: `(usdPrice − costPerKg) / usdPrice`. Mirrors the
 * GENERATED `price_quotes.margin_pct_at_quote` column. Returns `null` ("margin
 * unknown") when the cost is unknown/non-positive or the price is 0 — never a
 * fabricated number. `usdPrice` is the price already expressed in USD
 * (unit_price × fx_rate_to_usd), matching the generated column's inputs.
 */
export function marginPct(
  usdPrice: number,
  costPerKg: number | null | undefined,
): number | null {
  if (!costIsKnown(costPerKg) || usdPrice === 0) return null;
  return (usdPrice - costPerKg) / usdPrice;
}

/**
 * The markup-ON-COST floor price: `costPerKg × (1 + minMarginPct)`. Mirrors the
 * `_enforce_margin_floor` trigger's floor. Returns `null` when the cost is
 * unknown/non-positive — no fabricated floor (a floor of 0 would wrongly pass
 * every price).
 */
export function floorPrice(
  costPerKg: number | null | undefined,
  minMarginPct: number,
): number | null {
  if (!costIsKnown(costPerKg)) return null;
  return costPerKg * (1 + minMarginPct);
}

/**
 * The margin-floor guard: `true` when `usdPrice` is below the markup-on-cost
 * floor (with the DB's 1e-9 slack). Mirrors the `_enforce_margin_floor` trigger.
 * An unknown/non-positive cost is "allowed-but-flagged" — returns `false` (the
 * trigger lets a NULL-COGS insert through, flagged as margin-unknown), never a
 * reject. `usdPrice` is the price in USD (unit_price × fx_rate_to_usd).
 */
export function isBelowFloor(
  usdPrice: number,
  costPerKg: number | null | undefined,
  minMarginPct: number,
): boolean {
  const floor = floorPrice(costPerKg, minMarginPct);
  if (floor === null) return false; // NULL COGS ⇒ allowed-but-flagged, never rejected
  return usdPrice < floor - MARGIN_FLOOR_EPSILON;
}
