// P3-S16 — Accounting schema: the revenue ledger + AR docs + payments + FX SSOT.
//
// This is the books' SPINE (NOT double-entry bookkeeping — that's the BUY/INTEGRATE
// QBO/Xero seam). It builds ONLY the coffee-native financial layer and proves its
// data-layer invariants against HAND-COMPUTED seeds, RED first per the spec
// (PHASE3-DESIGN.md lines 355–366 + §1 cross-slice rails).
//
//   (1) FX SSOT — record_fx_rate is the ONLY fx_rate writer; fx_rate is append-only
//       (UPDATE/DELETE rejected); the RPC is idempotent on a tenant-qualified key.
//   (2) NO OFF-BOOK RATE — a revenue_entry's amount_usd MUST equal amount_doc ×
//       fx_rate_used (a same-row CHECK); a non-USD revenue row whose fx_rate_used has
//       no matching fx_rate row is rejected by the existence trigger.
//   (3) APPEND-ONLY LEDGERS — revenue_entry / ar_payment / fx_gain_loss_entry reject
//       UPDATE/DELETE; a reversal is a negative-amount row (sign CHECK), never an edit.
//   (4) AR DOC CANNOT BE OVERPAID — Σ ar_payment ≤ ar_doc.total (+ε) enforced by a
//       trigger; status is a DETERMINISTIC function of the paid sum (issued →
//       partially_paid → paid), never a manual flip (no client UPDATE grant on ar_doc).
//   (5) FX GAIN/LOSS TRACES TO TWO RATES — fx_gain_loss_entry.gain_usd must equal
//       amount_doc × (rate_at_receipt − rate_at_issue) (a same-row CHECK).
//   (6) v_lot_margin CLOSES THE LOOP — realized $/kg-green margin = revenue ⨝
//       mv_lot_cost.cost_per_kg_green; NULL cost ⇒ NULL margin (flagged, never fabricated).
//   (7) AD-8 GRANTS — authenticated reads every new table/view; anon reads/executes
//       NOTHING; record_fx_rate's EXECUTE is revoked from public.
//   (8) TENANT ISOLATION — a revenue row in tenant A is invisible to tenant B.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/** Seed a source (milled) lot and materialize a green lot from it. */
async function seedGreen(
  h: Harness,
  opts: { source: string; green: string; kg: number; score: number },
) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.source}', 'milled', 'Geisha', ${opts.kg}, ${opts.kg}, true, now());`,
  );
  await h.query(
    `select materialize_green_lot('${opts.source}','${opts.green}',${opts.kg},${opts.score},'WH-A', now());`,
  );
}

async function bookCostAndRefresh(h: Harness, lot: string, usd: number) {
  await h.query(
    `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('worker-day','direct-labor','lot','${lot}',${usd});`,
  );
  await h.query(`select refresh_lot_cost();`);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. FX SSOT — record_fx_rate is the only writer; append-only; idempotent.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S16 fx_rate — the canonical daily rate SSOT", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("record_fx_rate appends a rate and is idempotent on replay", async () => {
    const a = await h.query<{ id: number }>(
      `select record_fx_rate('2026-06-01','EUR','USD',1.08,'ecb','fx-eur-1') as id;`,
    );
    const b = await h.query<{ id: number }>(
      `select record_fx_rate('2026-06-01','EUR','USD',1.08,'ecb','fx-eur-1') as id;`,
    );
    expect(Number(a[0].id)).toBeGreaterThan(0);
    expect(Number(b[0].id)).toBe(Number(a[0].id)); // exactly-once replay
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from fx_rate where base='EUR' and quote='USD';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("fx_rate is append-only — UPDATE and DELETE are rejected", async () => {
    await h.query(`select record_fx_rate('2026-06-02','JPY','USD',0.0064,'ecb','fx-jpy-1');`);
    await expect(
      h.query(`update fx_rate set rate = 9 where base='JPY';`),
    ).rejects.toThrow(/append-only|not permitted/i);
    await expect(
      h.query(`delete from fx_rate where base='JPY';`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. revenue_entry — the journal source; FX consistency + off-book rejection.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S16 revenue_entry — no off-book FX, append-only journal", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-300", green: "JC-301", kg: 1000, score: 88 });
    await h.query(`select record_fx_rate('2026-06-01','EUR','USD',1.08,'ecb','fx-eur-rev');`);
  });
  afterAll(async () => h.close());

  it("accepts a USD revenue row whose amount_usd = amount_doc (fx 1.0)", async () => {
    const r = await h.query<{ id: number }>(
      `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used)
         values ('green_sale','JC-301', 7000, 'USD', 7000, 1) returning id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });

  it("REJECTS a row whose amount_usd ≠ amount_doc × fx_rate_used (the off-book CHECK)", async () => {
    await expect(
      h.query(
        `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used)
           values ('green_sale','JC-301', 1000, 'EUR', 5000, 1.08);`, // 1000×1.08 = 1080 ≠ 5000
      ),
    ).rejects.toThrow(/usd|fx|amount|consist|check/i);
  });

  it("accepts a non-USD row whose fx_rate_used matches an on-book fx_rate", async () => {
    // 1000 EUR × 1.08 = 1080 USD, and 1.08 IS on the books (fx-eur-rev).
    const r = await h.query<{ id: number }>(
      `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used)
         values ('green_sale','JC-301', 1000, 'EUR', 1080, 1.08) returning id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });

  it("REJECTS a non-USD row whose fx_rate_used is NOT on the books (no off-book rate)", async () => {
    await expect(
      h.query(
        `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used)
           values ('green_sale','JC-301', 1000, 'EUR', 1230, 1.23);`, // 1.23 not recorded
      ),
    ).rejects.toThrow(/off-book|fx_rate|no .*rate|unknown/i);
  });

  it("is append-only — UPDATE and DELETE rejected; a reversal is a negative row", async () => {
    const orig = await h.query<{ id: number }>(
      `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used)
         values ('green_sale','JC-301', 500, 'USD', 500, 1) returning id;`,
    );
    await expect(
      h.query(`update revenue_entry set amount_doc = 1 where id = ${orig[0].id};`),
    ).rejects.toThrow(/append-only|not permitted/i);
    await expect(
      h.query(`delete from revenue_entry where id = ${orig[0].id};`),
    ).rejects.toThrow(/append-only|not permitted/i);
    // a correcting REVERSAL is a negative-amount row pointing at the original.
    const rev = await h.query<{ id: number }>(
      `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used, reverses_id)
         values ('green_sale','JC-301', -500, 'USD', -500, 1, ${orig[0].id}) returning id;`,
    );
    expect(Number(rev[0].id)).toBeGreaterThan(0);
  });

  it("REJECTS a positive-amount 'reversal' (sign CHECK)", async () => {
    await expect(
      h.query(
        `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used, reverses_id)
           values ('green_sale','JC-301', 100, 'USD', 100, 1, 1);`,
      ),
    ).rejects.toThrow(/check|reversal|sign|negative/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. ar_doc + ar_payment — the no-overpay invariant + deterministic status.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S16 ar_doc — payments cap at the total, status is a function of the sum", () => {
  let h: Harness;
  let docId: number;
  beforeAll(async () => {
    h = await freshDb();
    const d = await h.query<{ id: number }>(
      `insert into ar_doc (kind, doc_number, status, total_doc, currency, total_usd, fx_rate_at_issue)
         values ('commercial_invoice','INV-0001','issued', 1000, 'USD', 1000, 1) returning id;`,
    );
    docId = Number(d[0].id);
  });
  afterAll(async () => h.close());

  it("a partial payment flips status to partially_paid", async () => {
    await h.query(
      `insert into ar_payment (ar_doc_id, method, amount_doc, currency, amount_usd_at_receipt, fx_rate_at_receipt)
         values (${docId}, 'wire', 400, 'USD', 400, 1);`,
    );
    const s = await h.query<{ status: string }>(
      `select status from ar_doc where id = ${docId};`,
    );
    expect(s[0].status).toBe("partially_paid");
  });

  it("REJECTS a payment that would exceed the doc total (no overpay)", async () => {
    // 400 already paid; a 700 payment would total 1100 > 1000 ⇒ rejected.
    await expect(
      h.query(
        `insert into ar_payment (ar_doc_id, method, amount_doc, currency, amount_usd_at_receipt, fx_rate_at_receipt)
           values (${docId}, 'wire', 700, 'USD', 700, 1);`,
      ),
    ).rejects.toThrow(/overpay|exceed|total|check/i);
  });

  it("paying the remaining balance flips status to paid", async () => {
    await h.query(
      `insert into ar_payment (ar_doc_id, method, amount_doc, currency, amount_usd_at_receipt, fx_rate_at_receipt)
         values (${docId}, 'wire', 600, 'USD', 600, 1);`,
    );
    const s = await h.query<{ status: string }>(
      `select status from ar_doc where id = ${docId};`,
    );
    expect(s[0].status).toBe("paid"); // 400 + 600 = 1000 = total
  });

  it("no client holds UPDATE on ar_doc — 'paid' can NEVER be set manually", async () => {
    const r = await h.query<{ au: boolean; anu: boolean }>(
      `select has_table_privilege('authenticated','ar_doc','update') as au,
              has_table_privilege('anon','ar_doc','update') as anu;`,
    );
    expect(r[0].au).toBe(false);
    expect(r[0].anu).toBe(false);
  });

  it("v_ar_aging reports the doc as fully paid with a zero balance", async () => {
    const r = await h.query<{ paid: number; balance: number; status: string }>(
      `select paid_usd as paid, balance_usd as balance, status from v_ar_aging where ar_doc_id = ${docId};`,
    );
    expect(Number(r[0].paid)).toBeCloseTo(1000, 6);
    expect(Number(r[0].balance)).toBeCloseTo(0, 6);
    expect(r[0].status).toBe("paid");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. fx_gain_loss_entry — realized FX must trace to TWO rates.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S16 fx_gain_loss_entry — the booked gain must equal the two-rate delta", () => {
  let h: Harness;
  let docId: number;
  beforeAll(async () => {
    h = await freshDb();
    const d = await h.query<{ id: number }>(
      `insert into ar_doc (kind, doc_number, status, total_doc, currency, total_usd, fx_rate_at_issue)
         values ('commercial_invoice','INV-FX1','issued', 1000, 'EUR', 1080, 1.08) returning id;`,
    );
    docId = Number(d[0].id);
  });
  afterAll(async () => h.close());

  it("accepts a gain that equals amount_doc × (rate_at_receipt − rate_at_issue)", async () => {
    // 1000 EUR, issue 1.08 → receipt 1.10: gain = 1000 × (1.10 − 1.08) = 20 USD.
    const r = await h.query<{ id: number }>(
      `insert into fx_gain_loss_entry (ar_doc_id, amount_doc, fx_rate_at_issue, fx_rate_at_receipt, gain_usd)
         values (${docId}, 1000, 1.08, 1.10, 20) returning id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });

  it("REJECTS a fabricated gain that does NOT trace to the two rates", async () => {
    await expect(
      h.query(
        `insert into fx_gain_loss_entry (ar_doc_id, amount_doc, fx_rate_at_issue, fx_rate_at_receipt, gain_usd)
           values (${docId}, 1000, 1.08, 1.10, 999);`, // should be 20, not 999
      ),
    ).rejects.toThrow(/check|gain|rate|trace/i);
  });

  it("is append-only — UPDATE rejected", async () => {
    await expect(
      h.query(`update fx_gain_loss_entry set gain_usd = 1 where ar_doc_id = ${docId};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("fx_attribution sums realized FX over a date window", async () => {
    const r = await h.query<{ gain: number }>(
      `select realized_fx_gain_usd as gain from fx_attribution('2026-01-01','2026-12-31');`,
    );
    expect(Number(r[0].gain)).toBeCloseTo(20, 6);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. v_lot_margin — THE number that closes the loop (revenue ⨝ true COGS).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S16 v_lot_margin — realized $/kg-green margin; NULL cost ⇒ NULL margin", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // JC-401: 1000 kg, cost 4000 ⇒ $4.00/kg-green; revenue 7000 ⇒ $7.00/kg ⇒ margin $3.00/kg.
    await seedGreen(h, { source: "JC-400", green: "JC-401", kg: 1000, score: 88 });
    await bookCostAndRefresh(h, "JC-401", 4000);
    await h.query(
      `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used)
         values ('green_sale','JC-401', 7000, 'USD', 7000, 1);`,
    );
    // JC-501: green lot seeded AFTER the last refresh ⇒ absent from the (stale) matview
    // ⇒ cogs NULL ⇒ margin NULL (flagged, never fabricated). It still has revenue.
    await seedGreen(h, { source: "JC-500", green: "JC-501", kg: 500, score: 88 });
    await h.query(
      `insert into revenue_entry (source_kind, green_lot_code, amount_doc, currency, amount_usd, fx_rate_used)
         values ('green_sale','JC-501', 3000, 'USD', 3000, 1);`,
    );
  });
  afterAll(async () => h.close());

  it("computes realized margin per kg-green from revenue and true COGS", async () => {
    const r = await h.query<{
      revenue: number; cost: number; rev_kg: number; margin_kg: number; margin_usd: number;
    }>(
      `select revenue_usd as revenue, cost_per_kg_green as cost,
              revenue_per_kg_green as rev_kg, margin_per_kg_green as margin_kg,
              margin_usd from v_lot_margin where green_lot_code = 'JC-401';`,
    );
    expect(Number(r[0].revenue)).toBeCloseTo(7000, 6);
    expect(Number(r[0].cost)).toBeCloseTo(4.0, 6);
    expect(Number(r[0].rev_kg)).toBeCloseTo(7.0, 6);
    expect(Number(r[0].margin_kg)).toBeCloseTo(3.0, 6); // 7.00 − 4.00
    expect(Number(r[0].margin_usd)).toBeCloseTo(3000, 6); // 7000 − 4000
  });

  it("flags NULL margin when COGS is unknown (no fabricated floor)", async () => {
    const r = await h.query<{ cost: number | null; margin_kg: number | null; margin_usd: number | null }>(
      `select cost_per_kg_green as cost, margin_per_kg_green as margin_kg, margin_usd
         from v_lot_margin where green_lot_code = 'JC-501';`,
    );
    expect(r[0].cost).toBeNull();
    expect(r[0].margin_kg).toBeNull();
    expect(r[0].margin_usd).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. AD-8 grant posture.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S16 AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  const TABLES = ["fx_rate", "revenue_entry", "ar_doc", "ar_doc_line", "ar_payment", "fx_gain_loss_entry"];
  const VIEWS = ["v_ar_aging", "v_lot_margin"];

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

  it("record_fx_rate is executable by authenticated, not anon, not public", async () => {
    const r = await h.query<{ a: boolean; an: boolean; pub: boolean }>(
      `select has_function_privilege('authenticated','record_fx_rate(date, text, text, numeric, text, text)','execute') as a,
              has_function_privilege('anon','record_fx_rate(date, text, text, numeric, text, text)','execute') as an,
              has_function_privilege('public','record_fx_rate(date, text, text, numeric, text, text)','execute') as pub;`,
    );
    expect(r[0].a).toBe(true);
    expect(r[0].an).toBe(false);
    expect(r[0].pub).toBe(false);
  });

  it("anon cannot read revenue_entry through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from revenue_entry limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. TENANT ISOLATION — a revenue row in A is invisible to B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S16 tenant isolation — the books do not leak cross-tenant", () => {
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
      `insert into revenue_entry (tenant_id, source_kind, amount_doc, currency, amount_usd, fx_rate_used)
         values ('${A}','tour', 200, 'USD', 200, 1),
                ('${B}','tour', 900, 'USD', 900, 1);`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, only A's revenue row is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string; amount_usd: number }>(`select tenant_id, amount_usd from revenue_entry;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
    expect(Number(rows[0].amount_usd)).toBeCloseTo(200, 6);
  });

  it("as tenant B, A's revenue row is invisible (no cross-tenant read)", async () => {
    const aVisible = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from revenue_entry where tenant_id = '${A}';`),
    );
    expect(aVisible).toHaveLength(0);
  });
});
