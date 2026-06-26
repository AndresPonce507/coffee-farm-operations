// P3-S0 — Dual-regime pricing core: the price every commerce slice reads.
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the pricing
// slice's data-layer invariants against HAND-COMPUTED seeds — written RED first per
// the spec (lines 167–189). The keystone: a Best-of-Panama Geisha physically CANNOT
// be quoted on the commodity index — the database refuses it.
//
//   (1) REGIME ISOLATION — quote_commodity_price (and a direct INSERT bypass) is
//       rejected for a Presidential/Specialty single-origin lot. Boundary 84.9 vs
//       85.0; a part-Geisha BLEND (not single-origin) is commodity-eligible.
//   (2) NO OVERSELL ON ACCEPT — accept_quote inserts a lot_reservations row, so the
//       EXISTING prevent_oversell trigger fires (no parallel counter). ATP debits.
//   (3) MARGIN FLOOR — a quote below cost×(1+min_margin_pct) is rejected via the RPC
//       AND a direct-insert bypass; NULL COGS ⇒ allowed-but-flagged (margin unknown),
//       never a fabricated floor.
//   (4) FIXATION REGIME GUARD — lock_fixation RAISES on a reserve quote.
//   (5) APPEND-ONLY — market-data ledgers reject UPDATE; price_quotes carries no
//       client UPDATE grant (status transitions flow through the SECDEF RPC).
//   (6) AD-8 GRANTS — authenticated reads every new table/view; anon reads/executes
//       NOTHING; every RPC's EXECUTE is revoked from public.
//   (7) TENANT ISOLATION — a row in tenant A is invisible to tenant B.
//   (8) convert_qty lb↔kg — a $/lb commodity quote yields the convert_qty-consistent
//       $/kg (NEVER a hardcoded 2.2046).
//
// All money math is hand-computed in the comments next to each assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

// The convert_qty-backed lb→kg PRICE factor: $/lb × (kg in lb) = $/kg.
// units.to_base: kg=1, [lb]=0.453592 ⇒ convert_qty(1,'kg','[lb]') = 1/0.453592.
const LB_PER_KG = 1 / 0.453592; // ≈ 2.2046226

/** Seed a source (milled) lot and materialize a green lot from it. */
async function seedGreen(
  h: Harness,
  opts: {
    source: string;
    green: string;
    kg: number;
    score: number;
    singleOrigin?: boolean;
    location?: string;
  },
) {
  const single = opts.singleOrigin ?? true;
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.source}', 'milled', 'Geisha', ${opts.kg}, ${opts.kg}, ${single}, now());`,
  );
  await h.query(
    `select materialize_green_lot('${opts.source}','${opts.green}',${opts.kg},${opts.score},'${opts.location ?? "WH-A"}', now());`,
  );
}

/** Book a cost to a green lot and refresh the COGS matview so cogs_per_lot reads it. */
async function bookCostAndRefresh(h: Harness, lot: string, usd: number) {
  await h.query(
    `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('worker-day','direct-labor','lot','${lot}',${usd});`,
  );
  await h.query(`select refresh_lot_cost();`);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. REGIME ISOLATION — the keystone guard.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S0 regime isolation — a crown-jewel Geisha cannot be sold as commodity", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // a Presidential single-origin Geisha (score 92) — reserve-mandatory.
    await seedGreen(h, { source: "JC-900", green: "JC-901", kg: 100, score: 92 });
    // a Premium single-origin lot (score 84.9 — just BELOW the 85 Specialty band).
    await seedGreen(h, { source: "JC-910", green: "JC-911", kg: 100, score: 84.9 });
    // a Specialty single-origin lot (score 85.0 — exactly ON the band boundary).
    await seedGreen(h, { source: "JC-920", green: "JC-921", kg: 100, score: 85.0 });
    // a Presidential BLEND (NOT single-origin) — reserve-band score but commodity-eligible.
    await seedGreen(h, {
      source: "JC-930",
      green: "JC-931",
      kg: 100,
      score: 92,
      singleOrigin: false,
    });
    // a December "C" mark so commodity quoting has data.
    await h.query(
      `select record_ice_c_quote('2026-12', 2.00, 'manual', now(), 'c-dec-1');`,
    );
  });
  afterAll(async () => h.close());

  it("price_regime_for_lot returns 'reserve' for a Presidential single-origin lot", async () => {
    const r = await h.query<{ v: string }>(
      `select price_regime_for_lot('JC-901') as v;`,
    );
    expect(r[0].v).toBe("reserve");
  });

  it("price_regime_for_lot returns 'commodity' for a Premium lot (84.9)", async () => {
    const r = await h.query<{ v: string }>(
      `select price_regime_for_lot('JC-911') as v;`,
    );
    expect(r[0].v).toBe("commodity");
  });

  it("price_regime_for_lot returns 'reserve' at the 85.0 Specialty boundary", async () => {
    const r = await h.query<{ v: string }>(
      `select price_regime_for_lot('JC-921') as v;`,
    );
    expect(r[0].v).toBe("reserve");
  });

  it("price_regime_for_lot returns 'commodity' for a Presidential BLEND (not single-origin)", async () => {
    const r = await h.query<{ v: string }>(
      `select price_regime_for_lot('JC-931') as v;`,
    );
    expect(r[0].v).toBe("commodity");
  });

  it("REJECTS quote_commodity_price for a Presidential single-origin Geisha (the keystone)", async () => {
    await expect(
      h.query(
        `select quote_commodity_price('JC-901', 30, '2026-12', 0.35, 'USD', 1, 'q-bad-1');`,
      ),
    ).rejects.toThrow(/reserve|commodity|Presidential|Specialty|single-origin/i);
  });

  it("REJECTS quote_commodity_price at the 85.0 Specialty boundary", async () => {
    await expect(
      h.query(
        `select quote_commodity_price('JC-921', 30, '2026-12', 0.35, 'USD', 1, 'q-bad-2');`,
      ),
    ).rejects.toThrow(/reserve|commodity|Specialty|single-origin/i);
  });

  it("REJECTS a direct INSERT bypassing the RPC (the trigger, not just the RPC, guards)", async () => {
    await expect(
      h.query(
        `insert into price_quotes
           (green_lot_code, regime, kg, unit_price, ice_c_contract_month, ice_c_price_at_quote, differential_usd_per_lb)
           values ('JC-901','commodity',30,500,'2026-12',2.00,0.35);`,
      ),
    ).rejects.toThrow(/reserve|commodity|Presidential|Specialty|single-origin/i);
  });

  it("ALLOWS commodity quoting for a Premium lot (84.9) just below the band", async () => {
    const r = await h.query<{ id: number }>(
      `select quote_commodity_price('JC-911', 30, '2026-12', 0.35, 'USD', 1, 'q-ok-prem') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });

  it("ALLOWS commodity quoting for a Presidential BLEND (not single-origin)", async () => {
    const r = await h.query<{ id: number }>(
      `select quote_commodity_price('JC-931', 30, '2026-12', 0.35, 'USD', 1, 'q-ok-blend') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. convert_qty lb↔kg — $/lb commodity math routes through the units table.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S0 commodity pricing — lb→kg factor routes through convert_qty (no 2.2046 hardcode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // Premium lot (commodity-eligible). Cost 4000 / 1000 kg = $4.00/kg green.
    await seedGreen(h, { source: "JC-700", green: "JC-701", kg: 1000, score: 83 });
    await bookCostAndRefresh(h, "JC-701", 4000);
    await h.query(
      `select record_ice_c_quote('2026-12', 2.00, 'manual', now(), 'c-1');`,
    );
  });
  afterAll(async () => h.close());

  it("units has a '[lb]' mass row and convert_qty(1,'kg','[lb]') ≈ 2.2046", async () => {
    const r = await h.query<{ v: number }>(
      `select convert_qty(1,'kg','[lb]') as v;`,
    );
    expect(Number(r[0].v)).toBeCloseTo(LB_PER_KG, 6);
  });

  it("a $/lb commodity quote yields the convert_qty-consistent $/kg", async () => {
    // unit_price/kg = ("C" 2.00 + diff 0.35) × (lb-per-kg) = 2.35 × 2.20462 = 5.18086
    await h.query(
      `select quote_commodity_price('JC-701', 30, '2026-12', 0.35, 'USD', 1, 'q-conv') as id;`,
    );
    const r = await h.query<{ unit_price: number; cost: number; month: string }>(
      `select unit_price, cost_per_kg_at_quote as cost, ice_c_contract_month as month
         from price_quotes where idempotency_key like '%q-conv';`,
    );
    expect(Number(r[0].unit_price)).toBeCloseTo(2.35 * LB_PER_KG, 5);
    expect(Number(r[0].cost)).toBeCloseTo(4.0, 6); // snapshot of cogs_per_lot
    expect(r[0].month).toBe("2026-12");
  });

  it("appends a 'price_quoted' lot_event keyed on the green lot code", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where stream_key = 'JC-701' and kind = 'price_quoted';`,
    );
    expect(r[0].n).toBeGreaterThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. NO OVERSELL ON ACCEPT — accept_quote inserts a lot_reservations row; the
//    EXISTING prevent_oversell trigger is the single guard. ATP debits.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S0 accept_quote — the money guarantee is REUSED (prevent_oversell), not rebuilt", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // 100 kg commodity-eligible lot; no cost booked ⇒ cogs NULL ⇒ margin floor skipped.
    await seedGreen(h, { source: "JC-800", green: "JC-801", kg: 100, score: 83 });
    await h.query(
      `select record_ice_c_quote('2026-12', 2.00, 'manual', now(), 'c-os');`,
    );
  });
  afterAll(async () => h.close());

  it("accepting a 60 kg quote inserts a reservation and debits ATP 100→40", async () => {
    const q = await h.query<{ id: number }>(
      `select quote_commodity_price('JC-801', 60, '2026-12', 0.35, 'USD', 1, 'q-os-60') as id;`,
    );
    await h.query(
      `select accept_quote(${Number(q[0].id)}, 'Tokyo Roaster', 'a-os-60');`,
    );
    const atp = await h.query<{ atp: number; reserved: number }>(
      `select atp, reserved_kg as reserved from green_lots_atp where green_lot_code='JC-801';`,
    );
    expect(Number(atp[0].reserved)).toBeCloseTo(60, 6);
    expect(Number(atp[0].atp)).toBeCloseTo(40, 6); // 100 − 60
    const status = await h.query<{ status: string; rid: number | null }>(
      `select status, reservation_id as rid from price_quotes where idempotency_key like '%q-os-60';`,
    );
    expect(status[0].status).toBe("accepted");
    expect(status[0].rid).not.toBeNull();
  });

  it("a second over-claim (70 kg, only 40 left) is REJECTED by prevent_oversell", async () => {
    const q = await h.query<{ id: number }>(
      `select quote_commodity_price('JC-801', 70, '2026-12', 0.35, 'USD', 1, 'q-os-70') as id;`,
    );
    await expect(
      h.query(`select accept_quote(${Number(q[0].id)}, 'Late Buyer', 'a-os-70');`),
    ).rejects.toThrow(/oversell|exceed|available|current_kg/i);
    // ATP unchanged — the whole accept txn rolled back.
    const atp = await h.query<{ atp: number }>(
      `select atp from green_lots_atp where green_lot_code='JC-801';`,
    );
    expect(Number(atp[0].atp)).toBeCloseTo(40, 6);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. MARGIN FLOOR — regime floor read from farm_season_config; NULL COGS flagged.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S0 margin floor — single-source floor, NULL COGS allowed-but-flagged", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // Premium lot, cost 4000/1000 = $4.00/kg. commodity_min_margin_pct = 0.10 ⇒ floor $4.40/kg.
    await seedGreen(h, { source: "JC-600", green: "JC-601", kg: 1000, score: 83 });
    await bookCostAndRefresh(h, "JC-601", 4000);
    // a green lot with NO cost booked + NOT refreshed into mv_lot_cost ⇒ cogs NULL.
    await seedGreen(h, { source: "JC-610", green: "JC-611", kg: 1000, score: 83 });
  });
  afterAll(async () => h.close());

  it("REJECTS a commodity quote that prices below cost×(1+0.10) via the RPC", async () => {
    // C 1.50 + diff 0.20 = 1.70 × 2.20462 = $3.748/kg < floor $4.40 ⇒ rejected.
    await h.query(
      `select record_ice_c_quote('2026-12', 1.50, 'manual', now(), 'c-low');`,
    );
    await expect(
      h.query(
        `select quote_commodity_price('JC-601', 30, '2026-12', 0.20, 'USD', 1, 'q-floor-rpc');`,
      ),
    ).rejects.toThrow(/margin|floor|below|cost/i);
  });

  it("REJECTS a direct-insert quote below the floor (trigger, not just RPC)", async () => {
    // unit_price 4.00 < floor 4.40 (cost 4.00 × 1.10) ⇒ trigger rejects.
    await expect(
      h.query(
        `insert into price_quotes
           (green_lot_code, regime, kg, unit_price, cost_per_kg_at_quote,
            ice_c_contract_month, ice_c_price_at_quote, differential_usd_per_lb)
           values ('JC-601','commodity',30,4.00,4.00,'2026-12',1.50,0.20);`,
      ),
    ).rejects.toThrow(/margin|floor|below|cost/i);
  });

  it("ALLOWS a quote at/above the floor and records margin_pct_at_quote", async () => {
    await h.query(
      `select record_ice_c_quote('2026-03', 2.00, 'manual', now(), 'c-ok');`,
    );
    // 2.35 × 2.20462 = $5.181/kg ≥ floor $4.40 ⇒ allowed.
    await h.query(
      `select quote_commodity_price('JC-601', 30, '2026-03', 0.35, 'USD', 1, 'q-floor-ok');`,
    );
    const r = await h.query<{ margin: number | null }>(
      `select margin_pct_at_quote as margin from price_quotes where idempotency_key like '%q-floor-ok';`,
    );
    // margin-on-revenue = (5.181 − 4.00) / 5.181 ≈ 0.2278
    expect(Number(r[0].margin)).toBeCloseTo((2.35 * LB_PER_KG - 4) / (2.35 * LB_PER_KG), 4);
  });

  it("ALLOWS a quote on a NULL-COGS lot and FLAGS margin unknown (no fabricated floor)", async () => {
    await h.query(
      `select record_ice_c_quote('2026-03', 2.00, 'manual', now(), 'c-null');`,
    );
    const r = await h.query<{ id: number }>(
      `select quote_commodity_price('JC-611', 30, '2026-03', 0.35, 'USD', 1, 'q-null-cogs') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
    const q = await h.query<{ cost: number | null; margin: number | null }>(
      `select cost_per_kg_at_quote as cost, margin_pct_at_quote as margin
         from price_quotes where idempotency_key like '%q-null-cogs';`,
    );
    expect(q[0].cost).toBeNull();
    expect(q[0].margin).toBeNull(); // "margin unknown", never fabricated
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. RESERVE PRICING + FIXATION REGIME GUARD.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S0 reserve pricing + fixation regime guard", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // a 92-point Presidential single-origin Geisha — reserve-mandatory.
    await seedGreen(h, { source: "JC-500", green: "JC-501", kg: 80, score: 92 });
    // a commodity lot for the positive fixation path.
    await seedGreen(h, { source: "JC-510", green: "JC-511", kg: 2000, score: 83 });
    await h.query(
      `select record_ice_c_quote('2026-12', 1.85, 'manual', now(), 'c-fix');`,
    );
  });
  afterAll(async () => h.close());

  it("seeds the $30,204/kg Best-of-Panama washed-Geisha auction comp anchor", async () => {
    const r = await h.query<{ price: number }>(
      `select price_usd_per_kg as price from auction_comps
         where variety = 'Geisha' and result_year = 2025 order by price_usd_per_kg desc limit 1;`,
    );
    expect(Number(r[0].price)).toBeCloseTo(30204, 0);
  });

  it("quote_reserve_price prices a Geisha off the model + comps and NEVER touches ice_c_quotes", async () => {
    const r = await h.query<{ id: number }>(
      `select quote_reserve_price('JC-501', 30, null, 'USD', 1, 'q-res') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
    const q = await h.query<{
      regime: string;
      month: string | null;
      diff: number | null;
      price: number;
    }>(
      `select regime, ice_c_contract_month as month, differential_usd_per_lb as diff, unit_price as price
         from price_quotes where idempotency_key like '%q-res';`,
    );
    expect(q[0].regime).toBe("reserve");
    expect(q[0].month).toBeNull(); // reserve quotes carry NO commodity leg
    expect(q[0].diff).toBeNull();
    // model = base 150 + coeff 60 × (score 92 − pivot 87) + scarcity 0 = 450 $/kg.
    // The lone seeded comp is the $30,204/kg champion — an UPPER reference only.
    // It must NEVER floor the model price UP (the keystone overprice bug): a single
    // outlier comp collapsing [min,max] to a point must not issue a world-record price.
    // JC-501 has no COGS booked ⇒ margin floor skipped ⇒ price stays the clamped model 450.
    expect(Number(q[0].price)).toBeCloseTo(450, 6);
  });

  it("a human override is honored on a reserve quote", async () => {
    await h.query(
      `select quote_reserve_price('JC-501', 30, 480, 'USD', 1, 'q-res-override');`,
    );
    const q = await h.query<{ price: number }>(
      `select unit_price as price from price_quotes where idempotency_key like '%q-res-override';`,
    );
    expect(Number(q[0].price)).toBeCloseTo(480, 6);
  });

  it("lock_fixation RAISES on a RESERVE quote (commodity-only instrument)", async () => {
    const q = await h.query<{ id: number }>(
      `select quote_reserve_price('JC-501', 10, 480, 'USD', 1, 'q-res-fix') as id;`,
    );
    await h.query(`select accept_quote(${Number(q[0].id)}, 'Tokyo', 'a-res-fix');`);
    await expect(
      h.query(`select lock_fixation(${Number(q[0].id)}, 'fix-bad');`),
    ).rejects.toThrow(/reserve|commodity|fixation/i);
  });

  it("lock_fixation locks an accepted COMMODITY quote and snapshots the live 'C'", async () => {
    const q = await h.query<{ id: number }>(
      `select quote_commodity_price('JC-511', 500, '2026-12', 0.35, 'USD', 1, 'q-com-fix') as id;`,
    );
    await h.query(`select accept_quote(${Number(q[0].id)}, 'Hamburg', 'a-com-fix');`);
    const f = await h.query<{ id: number }>(
      `select lock_fixation(${Number(q[0].id)}, 'fix-ok') as id;`,
    );
    expect(Number(f[0].id)).toBeGreaterThan(0);
    const row = await h.query<{ locked: number; month: string }>(
      `select ice_c_price_locked as locked, ice_c_contract_month as month from fixations;`,
    );
    expect(Number(row[0].locked)).toBeCloseTo(1.85, 6); // snapshot of v_ice_c_latest
    expect(row[0].month).toBe("2026-12");
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='JC-511' and kind='fixation_locked';`,
    );
    expect(ev[0].n).toBeGreaterThanOrEqual(1);
  });

  // The /hedge cockpit's ONE write affordance (Lock fixation) needs the price_quotes.id
  // to drive lock_fixation(p_quote_id). v_fixation_exposure MUST project it (as
  // price_quote_id) or the Lock button is permanently inert in production (the read
  // port maps a missing column to a null priceQuoteId, which disables the lock).
  it("v_fixation_exposure projects price_quote_id for the open commodity exposure (powers the Lock affordance)", async () => {
    const q = await h.query<{ id: number }>(
      `select quote_commodity_price('JC-511', 300, '2026-12', 0.35, 'USD', 1, 'q-com-exp') as id;`,
    );
    const quoteId = Number(q[0].id);
    // Accept but do NOT fix — this is exactly the row the Lock button must act on.
    await h.query(`select accept_quote(${quoteId}, 'Trieste', 'a-com-exp');`);
    const e = await h.query<{ price_quote_id: number; lot: string }>(
      `select price_quote_id, green_lot_code as lot from v_fixation_exposure
         where green_lot_code = 'JC-511' and price_quote_id = ${quoteId};`,
    );
    expect(e.length).toBe(1);
    expect(Number(e[0].price_quote_id)).toBe(quoteId);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. APPEND-ONLY — market-data ledgers immutable; price_quotes no client UPDATE.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S0 append-only posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `select record_ice_c_quote('2026-12', 2.00, 'manual', now(), 'c-imm');`,
    );
    await seedGreen(h, { source: "JC-400", green: "JC-401", kg: 100, score: 83 });
    await h.query(
      `select quote_commodity_price('JC-401', 10, '2026-12', 0.35, 'USD', 1, 'q-imm');`,
    );
  });
  afterAll(async () => h.close());

  it("rejects an UPDATE to ice_c_quotes (market data is append-only)", async () => {
    await expect(
      h.query(`update ice_c_quotes set price = 9 where idempotency_key like '%c-imm';`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("rejects a DELETE from ice_c_quotes", async () => {
    await expect(
      h.query(`delete from ice_c_quotes where idempotency_key like '%c-imm';`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("rejects an UPDATE to auction_comps", async () => {
    await expect(
      h.query(`update auction_comps set price_usd_per_kg = 1;`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("price_quotes grants NO update/delete to authenticated or anon", async () => {
    const r = await h.query<{ au: boolean; ad: boolean; anu: boolean }>(
      `select has_table_privilege('authenticated','price_quotes','update') as au,
              has_table_privilege('authenticated','price_quotes','delete') as ad,
              has_table_privilege('anon','price_quotes','update') as anu;`,
    );
    expect(r[0].au).toBe(false);
    expect(r[0].ad).toBe(false);
    expect(r[0].anu).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. AD-8 GRANTS — authenticated reads; anon reads/executes NOTHING.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S0 AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  const TABLES = [
    "ice_c_quotes",
    "auction_comps",
    "differential_schedule",
    "reserve_price_model",
    "price_quotes",
    "fixations",
  ];
  const VIEWS = ["v_ice_c_latest", "v_lot_price_book", "v_fixation_exposure"];

  it("authenticated holds SELECT on every new table and view", async () => {
    for (const t of [...TABLES, ...VIEWS]) {
      const r = await h.query<{ has: boolean }>(
        `select has_table_privilege('authenticated','${t}','select') as has;`,
      );
      expect(r[0].has, `authenticated should read ${t}`).toBe(true);
    }
  });

  it("anon holds NO SELECT on any new table or view", async () => {
    for (const t of [...TABLES, ...VIEWS]) {
      const r = await h.query<{ has: boolean }>(
        `select has_table_privilege('anon','${t}','select') as has;`,
      );
      expect(r[0].has, `anon must NOT read ${t}`).toBe(false);
    }
  });

  it("every command RPC is executable by authenticated, not anon, not public", async () => {
    const fns = [
      "record_ice_c_quote(text, numeric, text, timestamptz, text)",
      "record_auction_comp(text, text, text, text, numeric, numeric, integer, text)",
      "quote_commodity_price(text, numeric, text, numeric, text, numeric, text)",
      "quote_reserve_price(text, numeric, numeric, text, numeric, text)",
      "accept_quote(bigint, text, text)",
      "lock_fixation(bigint, text)",
      "price_regime_for_lot(text)",
    ];
    for (const fn of fns) {
      const r = await h.query<{ a: boolean; an: boolean; pub: boolean }>(
        `select has_function_privilege('authenticated','${fn}','execute') as a,
                has_function_privilege('anon','${fn}','execute') as an,
                has_function_privilege('public','${fn}','execute') as pub;`,
      );
      expect(r[0].a, `authenticated should execute ${fn}`).toBe(true);
      expect(r[0].an, `anon must NOT execute ${fn}`).toBe(false);
      expect(r[0].pub, `public must NOT execute ${fn}`).toBe(false);
    }
  });

  it("anon cannot read ice_c_quotes through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from ice_c_quotes limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. TENANT ISOLATION — a row in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S0 tenant isolation — market data does not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    // owner inserts with tenant_id stamped LITERALLY (default is NULL with >1 tenant).
    await h.query(
      `insert into ice_c_quotes (tenant_id, contract_month, price, source)
         values ('${A}','2026-12', 2.00, 'manual'),
                ('${B}','2026-12', 9.99, 'manual');`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, only A's ICE 'C' mark is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string; price: number }>(
        `select tenant_id, price from ice_c_quotes;`,
      ),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
    expect(Number(rows[0].price)).toBeCloseTo(2.0, 6);
  });

  it("as tenant B, A's mark is invisible (no cross-tenant read)", async () => {
    const aVisible = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from ice_c_quotes where tenant_id = '${A}';`),
    );
    expect(aVisible).toHaveLength(0);
  });
});
