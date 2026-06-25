// P3-S2 — B2B sample tracking + sample-approval-as-contract-prerequisite.
//
// Replays the REAL migrations in PGlite (AD-9) and proves the slice's data-layer
// invariants against HAND-COMPUTED seeds — written RED first per the spec (lines
// 213–224). The keystone: a reserve (crown-jewel) contract cannot be SIGNED until
// the buyer has APPROVED a pre-shipment sample of every reserve-band lot on it.
//
//   (1) DOGFOOD / KEYSTONE — a reserve contract for JC-204 is REFUSED at sign until a
//       200 g pre-shipment sample is logged AND approved; then it signs.
//   (2) PRE-SHIPMENT DRAW REUSES prevent_oversell — a pre_shipment sample inserts a
//       lot_shipments row (grams→kg via convert_qty), debiting ATP; a sample that
//       exceeds the lot's ATP is rejected by the EXISTING oversell trigger.
//   (3) DOCUMENTATION-ONLY SAMPLES — offer/type/arbitration samples claim NO ATP.
//   (4) COMMODITY CONTRACTS are unaffected — they sign with no sample.
//   (5) VERDICT — record_sample_verdict sets score/verdict, appends 'sample_approved'
//       ONLY on approval; rejection/counter do not unlock; idempotent replay.
//   (6) PIPELINE VIEW — v_sample_pipeline shows open (verdict-NULL) samples only.
//   (7) APPEND-ONLY / GRANTS — green_samples carries no client UPDATE/DELETE grant;
//       authenticated reads table+view; anon reads/executes NOTHING; every RPC's
//       EXECUTE is revoked from public.
//   (8) TENANT ISOLATION — a sample in tenant A is invisible to tenant B.

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

/** Create a buyer and return its id. */
async function seedBuyer(h: Harness, key: string, name = "Swiss Importer"): Promise<number> {
  const r = await h.query<{ id: number }>(
    `select create_b2b_buyer('${name}', 'CH', 'importer', 'CIF', 'USD', '${key}') as id;`,
  );
  return Number(r[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. DOGFOOD / KEYSTONE — reserve contract refuses to sign without an approved
//    pre-shipment sample; signs once the 200 g sample of JC-204 is approved.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S2 keystone — a reserve contract can't be signed without an approved pre-shipment sample", () => {
  let h: Harness;
  let contractId: number;
  let buyer: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-200", green: "JC-204", kg: 300, score: 91 }); // Presidential single-origin = reserve
    buyer = await seedBuyer(h, "buy-key");
    const c = await h.query<{ id: number }>(
      `select create_sales_contract(${buyer}, 'CIF', 'Hamburg', 'GCA', 'fixed', 'USD', 'k-key') as id;`,
    );
    contractId = Number(c[0].id);
    await h.query(`select add_contract_line(${contractId}, 'JC-204', 100, 480, null, null, 'cl-key');`);
  });
  afterAll(async () => h.close());

  it("REFUSES to sign the reserve contract before any sample exists (keystone)", async () => {
    await expect(
      h.query(`select sign_sales_contract(${contractId}, 'sign-nosample');`),
    ).rejects.toThrow(/approved pre-shipment sample|reserve contract/i);
  });

  it("REFUSES to sign while the sample is logged but NOT yet approved", async () => {
    await h.query(
      `select log_sample('JC-204', ${buyer}, 'pre_shipment', 200, 'DHL', 'DHL-204', 'samp-key') as id;`,
    );
    await expect(
      h.query(`select sign_sales_contract(${contractId}, 'sign-pending');`),
    ).rejects.toThrow(/approved pre-shipment sample|reserve contract/i);
  });

  it("SIGNS once the 200 g pre-shipment sample is APPROVED (the contract unlocks)", async () => {
    const s = await h.query<{ id: number }>(
      `select id from green_samples where tenant_id = current_tenant_id() and green_lot_code='JC-204'
         and sample_kind='pre_shipment' order by id limit 1;`,
    );
    await h.query(
      `select record_sample_verdict(${Number(s[0].id)}, 92, 'approved', 'verd-key');`,
    );
    await h.query(`select sign_sales_contract(${contractId}, 'sign-ok');`);
    const st = await h.query<{ status: string }>(
      `select status from sales_contracts where id = ${contractId};`,
    );
    expect(st[0].status).toBe("signed");
    // the unlock event landed on the lot's hash chain.
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='JC-204' and kind='sample_approved';`,
    );
    expect(ev[0].n).toBeGreaterThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. PRE-SHIPMENT DRAW reuses prevent_oversell (grams→kg via convert_qty).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S2 pre-shipment sample — claims ATP via lot_shipments, oversell-guarded", () => {
  let h: Harness;
  let buyer: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-700", green: "JC-704", kg: 1, score: 84 }); // tiny 1 kg commodity lot
    buyer = await seedBuyer(h, "buy-os");
  });
  afterAll(async () => h.close());

  it("a 200 g pre-shipment sample debits ATP by 0.2 kg (convert_qty g→kg) via a lot_shipments row", async () => {
    await h.query(
      `select log_sample('JC-704', ${buyer}, 'pre_shipment', 200, 'DHL', 'DHL-704', 'samp-os') as id;`,
    );
    const atp = await h.query<{ atp: number; shipped: number }>(
      `select atp, shipped_kg as shipped from green_lots_atp where green_lot_code='JC-704';`,
    );
    expect(Number(atp[0].shipped)).toBeCloseTo(0.2, 6);
    expect(Number(atp[0].atp)).toBeCloseTo(0.8, 6);
    // the sample row carries the shipment_id that claimed the draw.
    const s = await h.query<{ ship: number | null }>(
      `select shipment_id as ship from green_samples where idempotency_key like '%samp-os';`,
    );
    expect(s[0].ship).not.toBeNull();
  });

  it("a pre-shipment sample larger than the remaining ATP is REJECTED by prevent_oversell", async () => {
    // only 0.8 kg (800 g) left; a 2000 g draw must roll back.
    await expect(
      h.query(`select log_sample('JC-704', ${buyer}, 'pre_shipment', 2000, 'DHL', 'DHL-704b', 'samp-osb');`),
    ).rejects.toThrow(/oversell|exceed|available|current_kg/i);
    // ATP unchanged; no orphan sample committed.
    const atp = await h.query<{ atp: number }>(
      `select atp from green_lots_atp where green_lot_code='JC-704';`,
    );
    expect(Number(atp[0].atp)).toBeCloseTo(0.8, 6);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from green_samples where idempotency_key like '%samp-osb';`,
    );
    expect(n[0].n).toBe(0);
  });

  it("log_sample is idempotent — a replay returns the same sample id (no second draw)", async () => {
    const a = await h.query<{ id: number }>(
      `select log_sample('JC-704', ${buyer}, 'pre_shipment', 100, 'DHL', 'DHL-704c', 'samp-idem') as id;`,
    );
    const b = await h.query<{ id: number }>(
      `select log_sample('JC-704', ${buyer}, 'pre_shipment', 100, 'DHL', 'DHL-704c', 'samp-idem') as id;`,
    );
    expect(Number(a[0].id)).toBe(Number(b[0].id));
    // exactly ONE shipment for this sample (the replay did not draw again).
    const ships = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_shipments where destination = 'sample:DHL-704c';`,
    );
    expect(ships[0].n).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. DOCUMENTATION-ONLY samples + commodity contracts.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S2 documentation-only samples + commodity-contract pass-through", () => {
  let h: Harness;
  let buyer: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-500", green: "JC-504", kg: 50, score: 84 }); // commodity lot
    buyer = await seedBuyer(h, "buy-doc");
  });
  afterAll(async () => h.close());

  it("an OFFER sample claims NO ATP (side ledger, sub-resolution)", async () => {
    await h.query(
      `select log_sample('JC-504', ${buyer}, 'offer', 30, 'FedEx', 'FX-1', 'samp-offer') as id;`,
    );
    const atp = await h.query<{ atp: number; shipped: number }>(
      `select atp, shipped_kg as shipped from green_lots_atp where green_lot_code='JC-504';`,
    );
    expect(Number(atp[0].shipped)).toBeCloseTo(0, 6);
    expect(Number(atp[0].atp)).toBeCloseTo(50, 6);
    const s = await h.query<{ ship: number | null }>(
      `select shipment_id as ship from green_samples where idempotency_key like '%samp-offer';`,
    );
    expect(s[0].ship).toBeNull();
  });

  it("a COMMODITY contract signs with NO sample prerequisite", async () => {
    const c = await h.query<{ id: number }>(
      `select create_sales_contract(${buyer}, 'FOB', 'Balboa', 'GCA', 'fixed', 'USD', 'k-comm') as id;`,
    );
    const cid = Number(c[0].id);
    await h.query(`select add_contract_line(${cid}, 'JC-504', 10, 6.0, null, null, 'cl-comm');`);
    await h.query(`select sign_sales_contract(${cid}, 'sign-comm');`);
    const st = await h.query<{ status: string }>(
      `select status from sales_contracts where id = ${cid};`,
    );
    expect(st[0].status).toBe("signed");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. VERDICT mechanics + the pipeline view.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S2 record_sample_verdict + v_sample_pipeline", () => {
  let h: Harness;
  let buyer: number;
  let sampleId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-600", green: "JC-604", kg: 100, score: 84 });
    buyer = await seedBuyer(h, "buy-v");
    const s = await h.query<{ id: number }>(
      `select log_sample('JC-604', ${buyer}, 'type', 50, 'UPS', 'UPS-1', 'samp-v') as id;`,
    );
    sampleId = Number(s[0].id);
  });
  afterAll(async () => h.close());

  it("an un-judged sample shows on v_sample_pipeline (verdict NULL)", async () => {
    const rows = await h.query<{ sample_id: number; buyer_name: string }>(
      `select sample_id, buyer_name from v_sample_pipeline where sample_id = ${sampleId};`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].buyer_name).toBe("Swiss Importer");
  });

  it("a 'counter' verdict records on the row but appends NO sample_approved event", async () => {
    await h.query(`select record_sample_verdict(${sampleId}, 80, 'counter', 'verd-counter');`);
    const r = await h.query<{ verdict: string; score: number }>(
      `select buyer_verdict as verdict, buyer_score as score from green_samples where id = ${sampleId};`,
    );
    expect(r[0].verdict).toBe("counter");
    expect(Number(r[0].score)).toBeCloseTo(80, 6);
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='JC-604' and kind='sample_approved';`,
    );
    expect(ev[0].n).toBe(0);
    // judged → drops off the open pipeline.
    const open = await h.query<{ n: number }>(
      `select count(*)::int as n from v_sample_pipeline where sample_id = ${sampleId};`,
    );
    expect(open[0].n).toBe(0);
  });

  it("a later 'approved' verdict supersedes the counter and appends sample_approved exactly once", async () => {
    await h.query(`select record_sample_verdict(${sampleId}, 90, 'approved', 'verd-approve');`);
    await h.query(`select record_sample_verdict(${sampleId}, 90, 'approved', 'verd-approve');`); // replay
    const r = await h.query<{ verdict: string }>(
      `select buyer_verdict as verdict from green_samples where id = ${sampleId};`,
    );
    expect(r[0].verdict).toBe("approved");
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='JC-604' and kind='sample_approved';`,
    );
    expect(ev[0].n).toBe(1);
  });

  it("rejects an invalid verdict word", async () => {
    await expect(
      h.query(`select record_sample_verdict(${sampleId}, 50, 'maybe', 'verd-bad');`),
    ).rejects.toThrow(/invalid sample verdict/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. APPEND-ONLY / GRANTS — clients cannot write the sample ledger directly.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S2 append-only posture + AD-8 grants", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("green_samples grants NO update/delete to authenticated or anon", async () => {
    const r = await h.query<{ au: boolean; ad: boolean; anu: boolean; and_: boolean }>(
      `select has_table_privilege('authenticated','green_samples','update') as au,
              has_table_privilege('authenticated','green_samples','delete') as ad,
              has_table_privilege('anon','green_samples','update') as anu,
              has_table_privilege('anon','green_samples','delete') as and_;`,
    );
    expect(r[0].au).toBe(false);
    expect(r[0].ad).toBe(false);
    expect(r[0].anu).toBe(false);
    expect(r[0].and_).toBe(false);
  });

  it("authenticated holds SELECT on green_samples + v_sample_pipeline; anon holds none", async () => {
    for (const t of ["green_samples", "v_sample_pipeline"]) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${t}','select') as a,
                has_table_privilege('anon','${t}','select') as an;`,
      );
      expect(r[0].a, `authenticated should read ${t}`).toBe(true);
      expect(r[0].an, `anon must NOT read ${t}`).toBe(false);
    }
  });

  it("every command RPC is executable by authenticated, not anon, not public", async () => {
    const fns = [
      "log_sample(text, bigint, text, numeric, text, text, text)",
      "record_sample_verdict(bigint, numeric, text, text)",
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

  it("anon cannot read green_samples through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from green_samples limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. TENANT ISOLATION — a sample in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S2 tenant isolation — sample data does not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    // seed an A-scoped green lot + buyer + sample directly (owner bypasses RLS).
    await h.query(
      `insert into lots (code, tenant_id, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
         values ('JC-801','${A}','milled','Geisha',100,100,false, now());`,
    );
    await h.query(
      `insert into green_lots (tenant_id, lot_code, cupping_score, location)
         values ('${A}','JC-801',84,'WH-A');`,
    );
    await h.query(
      `insert into b2b_buyers (tenant_id, name, country_code) values ('${A}','A Buyer','JP');`,
    );
    await h.query(
      `insert into green_samples (tenant_id, green_lot_code, sample_kind, grams)
         values ('${A}','JC-801','offer',30);`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, A's sample is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string }>(`select tenant_id from green_samples;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
  });

  it("as tenant B, A's sample is invisible (no cross-tenant read)", async () => {
    const rows = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from green_samples where tenant_id = '${A}';`),
    );
    expect(rows).toHaveLength(0);
  });
});
