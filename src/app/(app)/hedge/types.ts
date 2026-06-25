/**
 * /hedge — the fixation-cockpit display contract (P3-S0).
 *
 * The cockpit is a pure presentational surface fed by the `src/lib/db/pricing.ts`
 * read port (`getFixationExposure()` / `getIceCLatest()`) and the
 * `src/lib/db/commands/lockFixation.ts` write port. Those ports are built by the
 * parallel pricing-port author; this file PUBLISHES the exact shapes the cockpit
 * consumes so the port binds to them (contract-first across the file-disjoint
 * fan-out).
 *
 * Data origin (migration 20260703090000_dual_regime_pricing.sql):
 *   - `FixationExposureRow` maps `v_fixation_exposure` — open commodity reservations
 *     not yet fixed × the current "C" mark. The VIEW is already commodity-only
 *     (`where pq.regime = 'commodity' and pq.status = 'accepted' and reservation_id
 *     is not null and not exists(fixations …)`), so reserve lots never appear; the
 *     cockpit ALSO defensively filters `regime === 'reserve'` (belt-and-braces).
 *   - `IceCMark` maps `v_ice_c_latest` — the latest "C" mark per contract month.
 */

/**
 * One open, un-fixed commodity reservation — the cockpit's display shape, mapped
 * by page.tsx from the `getFixationExposure()` read port (`FixationExposure`).
 *
 * ⚠️ CROSS-SLICE SEAM (HARD FLAG — the one thing that blocks lock-to-work):
 * `v_fixation_exposure` exposes `reservation_id` but NOT the price-quote id, and
 * `getFixationExposure()` therefore does NOT return one — yet
 * `lock_fixation(p_quote_id …)` / the `lockFixation` command key off the QUOTE id.
 * The fix is a one-liner on each side, owned by the migration + read-port authors:
 *   • `v_fixation_exposure`: add `pq.id as price_quote_id` to the SELECT.
 *   • `getFixationExposure`/`mapFixationExposure`: surface it as `priceQuoteId`.
 * Until then page.tsx maps `priceQuoteId` to `null` (it reads the field if the port
 * later provides it), and the lock affordance renders DISABLED with a "fixation id
 * pending" note — it NEVER fires `lock_fixation` with the wrong id. `reservation_id`
 * is 1:1 with the accepted, un-fixed commodity quote, so the join is unambiguous.
 */
export interface FixationExposureRow {
  /**
   * `price_quotes.id` — the argument `lock_fixation(p_quote_id, …)` requires.
   * `null` until the read port surfaces it (see the seam note above); the lock
   * affordance is disabled while it is null.
   */
  priceQuoteId: number | null;
  /** `v_fixation_exposure.green_lot_code`. */
  greenLotCode: string;
  /** `v_fixation_exposure.reservation_id` — the claim the fixation links. */
  reservationId: number;
  /** `v_fixation_exposure.kg` — un-fixed green kg on this reservation. */
  kg: number;
  /** `v_fixation_exposure.ice_c_contract_month` (e.g. "2026-12"). */
  iceCContractMonth: string;
  /**
   * `v_fixation_exposure.current_c_price` — latest "C" mark for the month.
   * NULL when no mark has been entered yet (exposure is then "unknown", never
   * fabricated — mirrors the NULL-COGS "margin unknown" posture).
   */
  currentCPrice: number | null;
  /** `v_fixation_exposure.exposure_usd` = current_c_price × kg × (kg→lb). NULL with no mark. */
  exposureUsd: number | null;
  /**
   * Defensive discriminator. The view is commodity-only, so the real port omits
   * this; the cockpit excludes any row that arrives flagged `'reserve'`.
   */
  regime?: "commodity" | "reserve";
}

/**
 * One row of `v_ice_c_latest` — the latest "C" mark per contract month.
 * Structurally the read port's `IceCLatest`; `source` is widened to `string`
 * (the port types it `IceCSource | string`) since the cockpit only labels it.
 */
export interface IceCMark {
  contractMonth: string;
  price: number;
  asOf: string;
  source: string;
}

/** Input the lock affordance hands the server action (idempotency key client-minted). */
export interface LockFixationInput {
  priceQuoteId: number;
  idempotencyKey: string;
}

/** Result envelope the server action returns to the lock affordance (friendly errors only). */
export type LockFixationResult =
  | { ok: true; fixationId?: number }
  | { ok: false; error: string };

/** The bound server action, passed down from the Server Component page to the client island. */
export type LockFixationAction = (
  input: LockFixationInput,
) => Promise<LockFixationResult>;
