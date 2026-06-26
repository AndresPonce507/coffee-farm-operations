// P3-S4 — Specialty auctions (Best of Panama / Cup of Excellence / Algrano).
//
// The highest-multiplier channel. These tests replay the REAL migrations in PGlite
// (AD-9) and prove the slice's load-bearing invariants against HAND-COMPUTED seeds —
// written RED first per the spec (PHASE3-DESIGN.md lines 245–260):
//
//   (1) ENTRY RIDES prevent_oversell (the money guarantee, REUSED) — enter_auction_lot
//       inserts a lot_reservations row keyed buyer='AUCTION:<name>', so the EXISTING
//       trigger fires (no parallel counter). ATP debits; an auction-committed lot
//       cannot then be double-sold via a B2B contract line, and a second over-claim
//       rolls the whole txn back.
//   (2) APPEND-ONLY SCORESHEETS — auction_scoresheets has no UPDATE/DELETE path
//       (immutability trigger); v_auction_final_score aggregates the jury panel.
//   (3) WRITE-BACK TO P3-S0 — a cleared lot posts an auction_comps row (feeding the
//       reserve comp library) AND a reserve price_quotes row that REUSES the existing
//       auction reservation (never a new claim), closing the loop; appends 'auction_sold'.
//   (4) THE BoP PREMIUM, VISIBLE — v_auction_results exposes the clearing price AND the
//       price-multiplier over the farm's commodity baseline.
//   (5) GRANTS / APPEND-ONLY — every table/view reads to authenticated, nothing to anon;
//       every RPC's EXECUTE is revoked from public then granted to authenticated.
//   (6) TENANT ISOLATION — an auction in tenant A is invisible to tenant B.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/** Seed a source (milled) lot and materialize a green lot from it. */
async function seedGreen(
  h: Harness,
  opts: { source: string; green: string; kg: number; score: number; singleOrigin?: boolean },
) {
  const single = opts.singleOrigin ?? true;
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.source}', 'milled', 'Geisha', ${opts.kg}, ${opts.kg}, ${single}, now());`,
  );
  await h.query(
    `select materialize_green_lot('${opts.source}','${opts.green}',${opts.kg},${opts.score},'WH-A', now());`,
  );
}

/** Create an auction and return its id. */
async function seedAuction(
  h: Harness,
  key: string,
  name = "Best of Panama 2026",
  platform = "best_of_panama",
): Promise<number> {
  const r = await h.query<{ id: number }>(
    `select create_auction('${platform}', '${name}', now() + interval '30 days',
                            now() + interval '20 days', '${key}') as id;`,
  );
  return Number(r[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. ENTRY RIDES prevent_oversell — the money guarantee is REUSED, not rebuilt.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S4 enter_auction_lot — an auction-committed lot cannot be double-sold", () => {
  let h: Harness;
  let auctionId: number;
  let entryId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-200", green: "JC-204", kg: 300, score: 91 }); // Presidential single-origin, 300 kg
    auctionId = await seedAuction(h, "auc-1");
    const e = await h.query<{ id: number }>(
      `select enter_auction_lot(${auctionId}, 'JC-204', 300, 'enter-1') as id;`,
    );
    entryId = Number(e[0].id);
  });
  afterAll(async () => h.close());

  it("entering the lot inserts an AUCTION-keyed reservation and debits ATP 300→0", async () => {
    const atp = await h.query<{ atp: number; reserved: number }>(
      `select atp, reserved_kg as reserved from green_lots_atp where green_lot_code='JC-204';`,
    );
    expect(Number(atp[0].reserved)).toBeCloseTo(300, 6);
    expect(Number(atp[0].atp)).toBeCloseTo(0, 6);
    // the entry carries the reservation, keyed buyer='AUCTION:<name>'.
    const ent = await h.query<{ rid: number | null }>(
      `select reservation_id as rid from auction_entries where id = ${entryId};`,
    );
    expect(ent[0].rid).not.toBeNull();
    const res = await h.query<{ buyer: string }>(
      `select buyer from lot_reservations where id = ${Number(ent[0].rid)};`,
    );
    expect(res[0].buyer).toMatch(/^AUCTION:/);
  });

  it("appends an 'auction_entered' lot_event keyed on the green lot", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='JC-204' and kind='auction_entered';`,
    );
    expect(r[0].n).toBeGreaterThanOrEqual(1);
  });

  it("a B2B contract line over the now-zero ATP is REJECTED by prevent_oversell (no double-sell)", async () => {
    const buyer = await h.query<{ id: number }>(
      `select create_b2b_buyer('Tokyo Roaster','JP','roaster','FOB','USD','buy-dbl') as id;`,
    );
    const c = await h.query<{ id: number }>(
      `select create_sales_contract(${Number(buyer[0].id)}, 'FOB', 'Balboa', 'GCA', 'fixed', 'USD', 'k-dbl') as id;`,
    );
    await expect(
      h.query(`select add_contract_line(${Number(c[0].id)}, 'JC-204', 50, 480, null, null, 'cl-dbl');`),
    ).rejects.toThrow(/oversell|exceed|available|current_kg/i);
  });

  it("is idempotent — replaying enter_auction_lot returns the same entry (no second claim)", async () => {
    const again = await h.query<{ id: number }>(
      `select enter_auction_lot(${auctionId}, 'JC-204', 300, 'enter-1') as id;`,
    );
    expect(Number(again[0].id)).toBe(entryId);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_reservations where green_lot_code='JC-204';`,
    );
    expect(n[0].n).toBe(1); // no parallel/duplicate reservation
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. APPEND-ONLY SCORESHEETS + v_auction_final_score aggregation.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S4 auction_scoresheets — append-only jury capture, aggregated", () => {
  let h: Harness;
  let entryId: number;
  let sheetId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-300", green: "JC-301", kg: 200, score: 90 });
    const auctionId = await seedAuction(h, "auc-sc");
    const e = await h.query<{ id: number }>(
      `select enter_auction_lot(${auctionId}, 'JC-301', 200, 'enter-sc') as id;`,
    );
    entryId = Number(e[0].id);
    // three juror marks: 91, 92, 93 → panel average 92.
    const s = await h.query<{ id: number }>(
      `select record_auction_scoresheet(${entryId}, 'juror-a', 'overall', 91, 'sheet-a') as id;`,
    );
    sheetId = Number(s[0].id);
    await h.query(`select record_auction_scoresheet(${entryId}, 'juror-b', 'overall', 92, 'sheet-b');`);
    await h.query(`select record_auction_scoresheet(${entryId}, 'juror-c', 'overall', 93, 'sheet-c');`);
  });
  afterAll(async () => h.close());

  it("v_auction_final_score averages the panel (91,92,93 → 92) and counts jurors", async () => {
    const r = await h.query<{ final_score: number; juror_count: number }>(
      `select final_score, juror_count from v_auction_final_score where entry_id = ${entryId};`,
    );
    expect(Number(r[0].final_score)).toBeCloseTo(92, 6);
    expect(Number(r[0].juror_count)).toBe(3);
  });

  it("a scoresheet row cannot be UPDATEd (append-only)", async () => {
    await expect(
      h.query(`update auction_scoresheets set score = 99 where id = ${sheetId};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("a scoresheet row cannot be DELETEd (append-only)", async () => {
    await expect(
      h.query(`delete from auction_scoresheets where id = ${sheetId};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("recording a scoresheet is idempotent on the key", async () => {
    const a = await h.query<{ id: number }>(
      `select record_auction_scoresheet(${entryId}, 'juror-a', 'overall', 91, 'sheet-a') as id;`,
    );
    expect(Number(a[0].id)).toBe(sheetId);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. WRITE-BACK TO P3-S0 — clearing posts a comp + a reserve quote (reservation REUSED).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S4 record_auction_result — the win seeds the next Geisha's reserve anchor", () => {
  let h: Harness;
  let entryId: number;
  let reservationId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-200", green: "JC-204", kg: 100, score: 91 }); // 91.5-jury target
    // a December "C" mark so the commodity baseline (multiplier denominator) exists.
    await h.query(`select record_ice_c_quote('2026-12', 2.00, 'manual', now(), 'c-dec');`);
    const auctionId = await seedAuction(h, "auc-res");
    const e = await h.query<{ id: number }>(
      `select enter_auction_lot(${auctionId}, 'JC-204', 100, 'enter-res') as id;`,
    );
    entryId = Number(e[0].id);
    const ent = await h.query<{ rid: number }>(
      `select reservation_id as rid from auction_entries where id = ${entryId};`,
    );
    reservationId = Number(ent[0].rid);
    // clears at $510/kg, jury 91.5, won by "Saint Coffee".
    await h.query(
      `select record_auction_result(${entryId}, 91.5, 510, 'Saint Coffee Roasters', 2026, 'res-1');`,
    );
  });
  afterAll(async () => h.close());

  it("stamps the entry's clearing price + jury score + winner and flips the auction to 'sold'", async () => {
    const r = await h.query<{ clearing: number; jury: number; winner: string; status: string }>(
      `select e.clearing_price_usd_per_kg as clearing, e.jury_score as jury,
              e.winning_bidder as winner, a.status
         from auction_entries e join auctions a on a.id = e.auction_id
        where e.id = ${entryId};`,
    );
    expect(Number(r[0].clearing)).toBeCloseTo(510, 6);
    expect(Number(r[0].jury)).toBeCloseTo(91.5, 6);
    expect(r[0].winner).toBe("Saint Coffee Roasters");
    expect(r[0].status).toBe("sold");
  });

  it("posts an auction_comps row feeding the reserve comp library (price 510, score 91.5)", async () => {
    const r = await h.query<{ n: number; price: number; score: number }>(
      `select count(*)::int as n, max(price_usd_per_kg) as price, max(cup_score) as score
         from auction_comps where lot_label = 'JC-204' and result_year = 2026;`,
    );
    expect(r[0].n).toBeGreaterThanOrEqual(1);
    expect(Number(r[0].price)).toBeCloseTo(510, 6);
    expect(Number(r[0].score)).toBeCloseTo(91.5, 6);
  });

  it("posts a reserve price_quotes row that REUSES the auction reservation (no double claim)", async () => {
    const q = await h.query<{ regime: string; unit_price: number; status: string; rid: number | null }>(
      `select regime, unit_price, status, reservation_id as rid
         from price_quotes where green_lot_code = 'JC-204';`,
    );
    expect(q.length).toBe(1);
    expect(q[0].regime).toBe("reserve");
    expect(Number(q[0].unit_price)).toBeCloseTo(510, 6);
    expect(q[0].status).toBe("accepted");
    expect(Number(q[0].rid)).toBe(reservationId); // the SAME reservation, not a new claim
    // exactly one reservation total — the loop closed without over-committing.
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_reservations where green_lot_code='JC-204';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("appends an 'auction_sold' lot_event keyed on the green lot", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='JC-204' and kind='auction_sold';`,
    );
    expect(r[0].n).toBeGreaterThanOrEqual(1);
  });

  it("v_auction_results exposes the BoP premium: clearing 510 ÷ commodity baseline = multiplier > 1", async () => {
    const r = await h.query<{ clearing: number; baseline: number; mult: number }>(
      `select clearing_price_usd_per_kg as clearing, commodity_baseline_usd_per_kg as baseline,
              price_multiplier as mult
         from v_auction_results where entry_id = ${entryId};`,
    );
    expect(Number(r[0].clearing)).toBeCloseTo(510, 6);
    expect(Number(r[0].baseline)).toBeGreaterThan(0);
    // multiplier = clearing ÷ baseline (the premium made visible), and a champion
    // Geisha clears far above the commodity index.
    expect(Number(r[0].mult)).toBeCloseTo(510 / Number(r[0].baseline), 4);
    expect(Number(r[0].mult)).toBeGreaterThan(1);
  });

  it("record_auction_result is idempotent (replay returns same entry, no second comp/quote)", async () => {
    const again = await h.query<{ id: number }>(
      `select record_auction_result(${entryId}, 91.5, 510, 'Saint Coffee Roasters', 2026, 'res-1') as id;`,
    );
    expect(Number(again[0].id)).toBe(entryId);
    const comps = await h.query<{ n: number }>(
      `select count(*)::int as n from auction_comps where lot_label = 'JC-204' and result_year = 2026;`,
    );
    expect(comps[0].n).toBe(1);
    const quotes = await h.query<{ n: number }>(
      `select count(*)::int as n from price_quotes where green_lot_code='JC-204';`,
    );
    expect(quotes[0].n).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. GRANTS / APPEND-ONLY posture (AD-8).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S4 append-only posture + AD-8 grants", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  const TABLES = ["auctions", "auction_entries", "auction_scoresheets"];
  const VIEWS = ["v_auction_final_score", "v_auction_results"];

  it("authenticated holds SELECT on every new table and view; anon holds NONE", async () => {
    for (const t of [...TABLES, ...VIEWS]) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${t}','select') as a,
                has_table_privilege('anon','${t}','select') as an;`,
      );
      expect(r[0].a, `authenticated should read ${t}`).toBe(true);
      expect(r[0].an, `anon must NOT read ${t}`).toBe(false);
    }
  });

  it("no new table grants insert/update/delete to authenticated or anon (RPC-only writes)", async () => {
    for (const t of TABLES) {
      const r = await h.query<{ ai: boolean; au: boolean; ad: boolean; ani: boolean }>(
        `select has_table_privilege('authenticated','${t}','insert') as ai,
                has_table_privilege('authenticated','${t}','update') as au,
                has_table_privilege('authenticated','${t}','delete') as ad,
                has_table_privilege('anon','${t}','insert') as ani;`,
      );
      expect(r[0].ai, `${t} insert to authenticated`).toBe(false);
      expect(r[0].au, `${t} update to authenticated`).toBe(false);
      expect(r[0].ad, `${t} delete to authenticated`).toBe(false);
      expect(r[0].ani, `${t} insert to anon`).toBe(false);
    }
  });

  it("every command RPC executes for authenticated, not anon, not public", async () => {
    const fns = [
      "create_auction(text, text, timestamptz, timestamptz, text)",
      "enter_auction_lot(bigint, text, numeric, text)",
      "record_auction_scoresheet(bigint, text, text, numeric, text)",
      "record_auction_result(bigint, numeric, numeric, text, integer, text)",
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

  it("anon cannot read auctions through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from auctions limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. TENANT ISOLATION — an auction in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S4 tenant isolation — auction data does not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    await h.query(
      `insert into auctions (tenant_id, platform, name) values
         ('${A}','best_of_panama','A BoP'),('${B}','cup_of_excellence','B CoE');`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, only A's auction is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string; name: string }>(`select tenant_id, name from auctions;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
    expect(rows[0].name).toBe("A BoP");
  });

  it("as tenant B, A's auction is invisible (no cross-tenant read)", async () => {
    const aVisible = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from auctions where tenant_id = '${A}';`),
    );
    expect(aVisible).toHaveLength(0);
  });
});
