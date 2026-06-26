import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/page-header";
import {
  getFixationExposure,
  getIceCLatest,
  type FixationExposure,
} from "@/lib/db/pricing";

import { FixationCockpit } from "@/app/(app)/hedge/fixation-cockpit";
import { lockFixationAction } from "@/app/(app)/hedge/actions";
import type {
  FixationExposureRow,
  IceCMark,
} from "@/app/(app)/hedge/types";

/**
 * Hedge — the "/hedge" route for Coffee Farm Operations (P3-S0).
 *
 * The FIXATION COCKPIT. It answers the one question the family lives on once a
 * green lot is sold on the commodity index but its "C" leg is still floating: how
 * much is our price exposed to the market right now, and which sales can we lock?
 *
 * Reads `v_fixation_exposure` (open commodity reservations not yet fixed × the live
 * "C" mark = unfixed price risk) and `v_ice_c_latest` (the live "C" reference)
 * through the pricing read ports, then renders each open reservation with a
 * human-confirmed, irreversible `lock_fixation` affordance. RESERVE lots are
 * commodity-free by construction (the view filters them out) and are visibly
 * excluded — only a commodity "C" leg can be hedged.
 *
 * Online-first (rail #9): locking needs server truth, so the cockpit is NOT routed
 * through the offline outbox. Thin async Server Component: it resolves the two read
 * ports in parallel, maps them to the cockpit's display shapes, and forwards them
 * — plus the bound write action — to the presentational cockpit.
 */
export default async function HedgePage() {
  const t = await getTranslations("hedge");
  const [exposure, iceC] = await Promise.all([
    getFixationExposure(),
    getIceCLatest(),
  ]);

  const rows: FixationExposureRow[] = exposure.map(toRow);
  const marks: IceCMark[] = iceC.map((m) => ({
    contractMonth: m.contractMonth,
    price: m.price,
    asOf: m.asOf,
    source: m.source,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />
      <FixationCockpit
        exposure={rows}
        iceC={marks}
        action={lockFixationAction}
      />
    </div>
  );
}

/**
 * Map a `getFixationExposure()` row to the cockpit's display row.
 *
 * `priceQuoteId` reads the read-port field when present, else `null` (see the seam
 * note in types.ts: `v_fixation_exposure` / `getFixationExposure` must surface
 * `price_quotes.id` for the lock to fire — until then the affordance is disabled,
 * never wrong). `regime` is left undefined — the source view is already
 * commodity-only.
 */
function toRow(e: FixationExposure): FixationExposureRow {
  const withQuote = e as FixationExposure & { priceQuoteId?: number | null };
  return {
    priceQuoteId: withQuote.priceQuoteId ?? null,
    greenLotCode: e.greenLotCode,
    reservationId: e.reservationId,
    kg: e.kg,
    iceCContractMonth: e.iceCContractMonth,
    currentCPrice: e.currentCPrice,
    exposureUsd: e.exposureUsd,
  };
}
