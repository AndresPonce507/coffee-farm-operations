// P3-S3 — Export shipments + export-doc-pack engine (THE HEADLINE SLICE).
//
// Replays the REAL migrations in PGlite (AD-9) and proves the slice's load-bearing
// invariants against HAND-BUILT lineage — written RED first per the spec
// (PHASE3-DESIGN.md lines 225–241). The headline: an export doc cannot issue without
// its declarative prerequisites, evaluated against LIVE state.
//
//   (1) THE HEADLINE GATE — issue_export_doc raises unless export_doc_prereqs_unmet is
//       empty. A non-deforestation-free lot physically cannot get a Certificate of
//       Origin; the B/L is chain-locked until the other four docs are issued.
//   (2) PREREQ COMPLETENESS — one fail-closed assertion per (doc_kind, prereq): the
//       commercial invoice needs a SIGNED contract, the CO needs EUDR-compliant lots,
//       the phyto needs the packing list, the B/L needs all four others (the keystone).
//   (3) SHIPMENT LINES REUSE prevent_oversell — each export_shipment_line inserts a
//       lot_shipments row (net_kg = bags × bag_weight), so the EXISTING oversell
//       trigger guards physical over-shipment (no parallel counter).
//   (4) APPEND-ONLY LEGAL INSTRUMENTS — export_documents payloads are frozen at issue;
//       only the supersession pointer may change; re-issue = a superseding row; the
//       partial unique index keeps exactly one LIVE doc per kind.
//   (5) HASH-CHAIN — every issue appends 'export_doc_issued' per loaded green lot, so
//       verify_chain(lot) covers the lot's entire commercial life through departure.
//   (6) GRANTS / TENANT ISOLATION — every table/view reads to authenticated, nothing
//       to anon; every RPC's EXECUTE is revoked from public; data is tenant-scoped.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

// ──────────────────────────────────────────────────────────────────────────
// Fixture helpers — a geolocated plot → harvest → source lot → green lot, plus a
// signed COMMODITY contract (so signing needs no reserve sample) and a buyer.
// ──────────────────────────────────────────────────────────────────────────
const WORKER = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
  values ('w-x1', 'Export Picker', 'Picker', 22, 'present', 2015, '+507 0000-0000', 'Crew X');`;

/** A geolocated plot (GeoJSON Polygon + centroid Point), pre-cutoff, undeclared. */
function geoPlot(id: string, ord: number, established = 2015): string {
  return `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl,
            trees, shade_pct, established_year, status, last_inspected,
            expected_yield_kg, harvested_kg, geom, centroid)
          values ('${id}', ${ord}, 'Plot ${id}', 'Block ${id}', 'Geisha', 1.5, 1500,
            120, 50, ${established}, 'healthy', '2026-06-01', 1000, 800,
            '{"type":"Polygon","coordinates":[[[-82.64,8.77],[-82.63,8.77],[-82.63,8.78],[-82.64,8.78],[-82.64,8.77]]]}'::jsonb,
            '{"type":"Point","coordinates":[-82.635,8.775]}'::jsonb);`;
}

/** Seed plot → harvest → milled source lot → materialize a commodity green lot. */
async function seedTraceableGreen(
  h: Harness,
  opts: { plot: string; ord: number; source: string; green: string; kg: number; score: number },
) {
  await h.db.exec(geoPlot(opts.plot, opts.ord));
  await h.db.exec(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.source}', 'milled', 'Geisha', ${opts.kg}, ${opts.kg}, false, now());`,
  );
  await h.db.exec(
    `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
       values ('h-${opts.source}', '2026-06-01', '${opts.plot}', 'w-x1', 50, 92, 22, '${opts.source}');`,
  );
  await h.query(
    `select materialize_green_lot('${opts.source}','${opts.green}',${opts.kg},${opts.score},'WH-X', now());`,
  );
}

/** Create a buyer, contract (commodity/fixed), one line reserving kg, and sign it. */
async function seedSignedContract(
  h: Harness,
  opts: { lot: string; kg: number; key: string },
): Promise<{ contractId: number; lineId: number }> {
  const b = await h.query<{ id: number }>(
    `select create_b2b_buyer('Hamburg Importer', 'DE', 'importer', 'FOB', 'USD', 'buy-${opts.key}') as id;`,
  );
  const c = await h.query<{ id: number }>(
    `select create_sales_contract(${Number(b[0].id)}, 'FOB', 'Balboa', 'GCA', 'fixed', 'USD', 'k-${opts.key}') as id;`,
  );
  const contractId = Number(c[0].id);
  const l = await h.query<{ id: number }>(
    `select add_contract_line(${contractId}, '${opts.lot}', ${opts.kg}, 4.5, null, null, 'cl-${opts.key}') as id;`,
  );
  await h.query(`select sign_sales_contract(${contractId}, 'sign-${opts.key}');`);
  return { contractId, lineId: Number(l[0].id) };
}

// ──────────────────────────────────────────────────────────────────────────
// 1. THE HEADLINE DOGFOOD — build a shipment, load bags, and watch the
//    Certificate-of-Origin tile stay RED until the EUDR declaration lands.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S3 headline — the export-doc-pack gate (EUDR + chain-locked B/L)", () => {
  let h: Harness;
  let shipmentId: number;
  let lineId: number;
  beforeAll(async () => {
    h = await freshDb();
    // a commodity green lot of 500 kg traced to plot p-x (geolocated, undeclared).
    await h.db.exec(WORKER);
    await seedTraceableGreen(h, { plot: "p-x", ord: 980, source: "JC-700", green: "JC-704", kg: 500, score: 84 });
    const { contractId, lineId: lid } = await seedSignedContract(h, { lot: "JC-704", kg: 240, key: "x" });
    lineId = lid;
    const s = await h.query<{ id: number }>(
      `select build_export_shipment(${contractId}, 'Balboa, PA', 30, 'ship-x') as id;`,
    );
    shipmentId = Number(s[0].id);
    // load 8 bags × 30 kg = 240 kg (the shipment-line claim guards it).
    await h.query(`select add_shipment_line(${shipmentId}, ${lineId}, 8, 'line-x');`);
  });
  afterAll(async () => h.close());

  it("build_export_shipment mints a JC-S-NNNN shipment_no in 'building' status", async () => {
    const r = await h.query<{ no: string; status: string }>(
      `select shipment_no as no, status from export_shipments where id = ${shipmentId};`,
    );
    expect(r[0].no).toMatch(/^JC-S-\d{4}$/);
    expect(r[0].status).toBe("building");
  });

  it("add_shipment_line draws ATP via lot_shipments (net 240 kg) and ties the lot_shipment_id", async () => {
    const atp = await h.query<{ atp: number; shipped: number; reserved: number }>(
      `select atp, shipped_kg as shipped, reserved_kg as reserved from green_lots_atp where green_lot_code='JC-704';`,
    );
    // 240 reserved by the contract line + 240 shipped by the export line = 480 of 500.
    expect(Number(atp[0].reserved)).toBeCloseTo(240, 6);
    expect(Number(atp[0].shipped)).toBeCloseTo(240, 6);
    expect(Number(atp[0].atp)).toBeCloseTo(20, 6);
    const line = await h.query<{ net: number; ship: number | null }>(
      `select net_kg as net, lot_shipment_id as ship from export_shipment_lines where shipment_id = ${shipmentId};`,
    );
    expect(Number(line[0].net)).toBeCloseTo(240, 6);
    expect(line[0].ship).not.toBeNull();
  });

  it("the commercial invoice issues immediately (its prereq — a signed contract — is met)", async () => {
    const d = await h.query<{ id: number }>(
      `select issue_export_doc(${shipmentId}, 'commercial_invoice', 'doc-ci') as id;`,
    );
    expect(Number(d[0].id)).toBeGreaterThan(0);
    const row = await h.query<{ kind: string; no: string; consignee: string }>(
      `select doc_kind as kind, doc_no as no, payload->'consignee'->>'name' as consignee
         from export_documents where id = ${Number(d[0].id)};`,
    );
    expect(row[0].kind).toBe("commercial_invoice");
    expect(row[0].no).toMatch(/^JC-XD-\d{4}$/);
    expect(row[0].consignee).toBe("Hamburg Importer"); // payload snapshot frozen at issue
  });

  it("the Certificate of Origin is BLOCKED while the origin plot is undeclared (EUDR incomplete)", async () => {
    // the readiness view shows the CO tile RED with its unmet prereq named.
    const r = await h.query<{ issued: boolean; unmet: string[] }>(
      `select issued, unmet_prereqs as unmet from v_export_pack_readiness
         where shipment_id = ${shipmentId} and doc_kind = 'certificate_of_origin';`,
    );
    expect(r[0].issued).toBe(false);
    expect(r[0].unmet.join(" ")).toMatch(/eudr/i);
    // issuing it raises with the EXACT unmet prerequisite (auditor-honest, never blank).
    await expect(
      h.query(`select issue_export_doc(${shipmentId}, 'certificate_of_origin', 'doc-co-fail');`),
    ).rejects.toThrow(/blocked|prerequisite|eudr/i);
  });

  it("after eudr_declare_plot the lot reads 'compliant' and the CO issues", async () => {
    await h.query(`select eudr_declare_plot('p-x', true, 'established-pre-cutoff');`);
    const v = await h.query<{ v: string }>(`select eudr_lot_status('JC-704') as v;`);
    expect(v[0].v).toBe("compliant");
    const d = await h.query<{ id: number }>(
      `select issue_export_doc(${shipmentId}, 'certificate_of_origin', 'doc-co') as id;`,
    );
    expect(Number(d[0].id)).toBeGreaterThan(0);
    // the frozen payload carries each lot's EUDR verdict (the substantiation snapshot).
    const eudr = await h.query<{ s: string }>(
      `select payload->'lines'->0->>'eudr_status' as s from export_documents where id = ${Number(d[0].id)};`,
    );
    expect(eudr[0].s).toBe("compliant");
  });

  it("the B/L is chain-locked until the other four docs are all issued (THE KEYSTONE)", async () => {
    // invoice + CO are issued; packing list + phyto are not yet → B/L blocked.
    await expect(
      h.query(`select issue_export_doc(${shipmentId}, 'bill_of_lading', 'doc-bl-early');`),
    ).rejects.toThrow(/blocked|prerequisite|packing|phyto/i);

    // issue the packing list (no prereq), then the phyto (needs the packing list).
    await h.query(`select issue_export_doc(${shipmentId}, 'packing_list', 'doc-pl');`);
    await h.query(`select issue_export_doc(${shipmentId}, 'phytosanitary', 'doc-ph');`);

    // now all four are issued → the B/L unlocks, and the shipment flips to 'docs_issued'.
    const bl = await h.query<{ id: number }>(
      `select issue_export_doc(${shipmentId}, 'bill_of_lading', 'doc-bl') as id;`,
    );
    expect(Number(bl[0].id)).toBeGreaterThan(0);
    const st = await h.query<{ status: string }>(
      `select status from export_shipments where id = ${shipmentId};`,
    );
    expect(st[0].status).toBe("docs_issued");
  });

  it("appends an 'export_doc_issued' lot_event per issue, keyed on the green lot (verify_chain coverage)", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='JC-704' and kind='export_doc_issued';`,
    );
    expect(r[0].n).toBe(5); // invoice, CO, packing list, phyto, B/L
  });

  it("v_export_doc_pack exposes exactly the five LIVE docs with their frozen payloads", async () => {
    const rows = await h.query<{ doc_kind: string }>(
      `select doc_kind from v_export_doc_pack where shipment_id = ${shipmentId} order by doc_kind;`,
    );
    expect(rows.map((r) => r.doc_kind).sort()).toEqual(
      ["bill_of_lading", "certificate_of_origin", "commercial_invoice", "packing_list", "phytosanitary"].sort(),
    );
  });

  it("issue_export_doc is idempotent on its key (replay returns the same doc, no second row)", async () => {
    const a = await h.query<{ id: number }>(
      `select issue_export_doc(${shipmentId}, 'commercial_invoice', 'doc-ci') as id;`,
    );
    const live = await h.query<{ n: number }>(
      `select count(*)::int as n from export_documents
         where shipment_id = ${shipmentId} and doc_kind='commercial_invoice' and superseded_by is null;`,
    );
    expect(Number(a[0].id)).toBeGreaterThan(0);
    expect(live[0].n).toBe(1); // still exactly one live invoice
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. PREREQ COMPLETENESS — one fail-closed assertion per (doc_kind, prereq).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S3 prereq table — each prerequisite fails the issue closed when individually unmet", () => {
  let h: Harness;
  let shipmentId: number;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(WORKER);
    await seedTraceableGreen(h, { plot: "p-p", ord: 981, source: "JC-710", green: "JC-714", kg: 500, score: 84 });
    // a DRAFT contract (NOT signed) so the commercial-invoice prereq is unmet.
    const b = await h.query<{ id: number }>(
      `select create_b2b_buyer('Oslo Roaster','NO','roaster','FOB','USD','buy-p') as id;`,
    );
    const c = await h.query<{ id: number }>(
      `select create_sales_contract(${Number(b[0].id)}, 'FOB', 'Balboa', 'GCA', 'fixed', 'USD', 'k-p') as id;`,
    );
    const contractId = Number(c[0].id);
    const l = await h.query<{ id: number }>(
      `select add_contract_line(${contractId}, 'JC-714', 200, 4.5, null, null, 'cl-p') as id;`,
    );
    const s = await h.query<{ id: number }>(
      `select build_export_shipment(${contractId}, 'Balboa, PA', 30, 'ship-p') as id;`,
    );
    shipmentId = Number(s[0].id);
    await h.query(`select add_shipment_line(${shipmentId}, ${Number(l[0].id)}, 6, 'line-p');`);
  });
  afterAll(async () => h.close());

  it("commercial_invoice ⇐ contract_signed: blocked while the contract is a draft", async () => {
    const unmet = await h.query<{ u: string[] }>(
      `select export_doc_prereqs_unmet(${shipmentId}, 'commercial_invoice') as u;`,
    );
    expect(unmet[0].u.length).toBeGreaterThan(0);
    await expect(
      h.query(`select issue_export_doc(${shipmentId}, 'commercial_invoice', 'd-ci');`),
    ).rejects.toThrow(/blocked|prerequisite|contract/i);
  });

  it("certificate_of_origin ⇐ eudr_compliant: blocked while the origin plot is undeclared", async () => {
    const unmet = await h.query<{ u: string[] }>(
      `select export_doc_prereqs_unmet(${shipmentId}, 'certificate_of_origin') as u;`,
    );
    expect(unmet[0].u.join(" ")).toMatch(/eudr/i);
    await expect(
      h.query(`select issue_export_doc(${shipmentId}, 'certificate_of_origin', 'd-co');`),
    ).rejects.toThrow(/blocked|prerequisite|eudr/i);
  });

  it("phytosanitary ⇐ packing_list issued: blocked while no packing list exists", async () => {
    const unmet = await h.query<{ u: string[] }>(
      `select export_doc_prereqs_unmet(${shipmentId}, 'phytosanitary') as u;`,
    );
    expect(unmet[0].u.join(" ")).toMatch(/packing/i);
    await expect(
      h.query(`select issue_export_doc(${shipmentId}, 'phytosanitary', 'd-ph');`),
    ).rejects.toThrow(/blocked|prerequisite|packing/i);
  });

  it("bill_of_lading ⇐ all four other docs: unmet lists every missing doc (the keystone)", async () => {
    const unmet = await h.query<{ u: string[] }>(
      `select export_doc_prereqs_unmet(${shipmentId}, 'bill_of_lading') as u;`,
    );
    // none of the four others is issued yet → all four labels are unmet.
    expect(unmet[0].u.length).toBe(4);
    await expect(
      h.query(`select issue_export_doc(${shipmentId}, 'bill_of_lading', 'd-bl');`),
    ).rejects.toThrow(/blocked|prerequisite/i);
  });

  it("packing_list has NO prereq — it issues on a draft contract with no EUDR declaration", async () => {
    const unmet = await h.query<{ u: string[] }>(
      `select export_doc_prereqs_unmet(${shipmentId}, 'packing_list') as u;`,
    );
    expect(unmet[0].u.length).toBe(0);
    const d = await h.query<{ id: number }>(
      `select issue_export_doc(${shipmentId}, 'packing_list', 'd-pl') as id;`,
    );
    expect(Number(d[0].id)).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. SHIPMENT LINES reuse prevent_oversell + append-only payloads + supersession.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S3 shipment lines + append-only documents", () => {
  let h: Harness;
  let shipmentId: number;
  let lineId: number;
  let docId: number;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(WORKER);
    await seedTraceableGreen(h, { plot: "p-o", ord: 982, source: "JC-720", green: "JC-724", kg: 300, score: 84 });
    const { contractId, lineId: lid } = await seedSignedContract(h, { lot: "JC-724", kg: 100, key: "o" });
    lineId = lid;
    const s = await h.query<{ id: number }>(
      `select build_export_shipment(${contractId}, 'Balboa, PA', 30, 'ship-o') as id;`,
    );
    shipmentId = Number(s[0].id);
    await h.query(`select add_shipment_line(${shipmentId}, ${lineId}, 3, 'line-o');`); // 3×30 = 90 kg
    const d = await h.query<{ id: number }>(
      `select issue_export_doc(${shipmentId}, 'commercial_invoice', 'doc-o') as id;`,
    );
    docId = Number(d[0].id);
  });
  afterAll(async () => h.close());

  it("an over-shipment beyond the remaining ATP is REJECTED by prevent_oversell", async () => {
    // 300 kg lot; 100 reserved + 90 shipped = 190 committed → 110 ATP left. A 5-bag
    // (150 kg) draw would push committed to 340 > 300 and must roll back.
    await expect(
      h.query(`select add_shipment_line(${shipmentId}, ${lineId}, 5, 'line-o-over');`),
    ).rejects.toThrow(/oversell|exceed|available|current_kg/i);
  });

  it("a frozen export_documents payload cannot be UPDATEd (append-only)", async () => {
    await expect(
      h.query(`update export_documents set payload = '{}'::jsonb where id = ${docId};`),
    ).rejects.toThrow(/append-only|frozen|not permitted/i);
  });

  it("an export_documents row cannot be DELETEd (append-only)", async () => {
    await expect(
      h.query(`delete from export_documents where id = ${docId};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("re-issuing supersedes: the old row gets superseded_by set, exactly one LIVE doc remains", async () => {
    const re = await h.query<{ id: number }>(
      `select issue_export_doc(${shipmentId}, 'commercial_invoice', 'doc-o-reissue') as id;`,
    );
    const newId = Number(re[0].id);
    expect(newId).not.toBe(docId);
    // the old doc now points at the new one; the new one is live.
    const old = await h.query<{ sup: number | null }>(
      `select superseded_by as sup from export_documents where id = ${docId};`,
    );
    expect(Number(old[0].sup)).toBe(newId);
    const live = await h.query<{ n: number }>(
      `select count(*)::int as n from export_documents
         where shipment_id = ${shipmentId} and doc_kind='commercial_invoice' and superseded_by is null;`,
    );
    expect(live[0].n).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. GRANTS / APPEND-ONLY posture (AD-8).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S3 AD-8 grants + append-only posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  const TABLES = ["export_shipments", "export_shipment_lines", "export_documents", "export_doc_prereqs"];
  const VIEWS = ["v_export_pack_readiness", "v_export_doc_pack"];

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
      "build_export_shipment(bigint, text, numeric, text)",
      "add_shipment_line(bigint, bigint, integer, text)",
      "issue_export_doc(bigint, text, text)",
      "export_doc_prereqs_unmet(bigint, text)",
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

  it("anon cannot read export_documents through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from export_documents limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. TENANT ISOLATION — a shipment in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S3 tenant isolation — export data does not leak cross-tenant", () => {
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
      `insert into b2b_buyers (tenant_id, name, country_code) values ('${A}','A Buyer','DE');`,
    );
    await h.query(
      `insert into sales_contracts (tenant_id, contract_no, buyer_id, incoterm, pricing_basis)
         select '${A}','JC-K-0001', id, 'FOB', 'fixed' from b2b_buyers where tenant_id='${A}';`,
    );
    await h.query(
      `insert into export_shipments (tenant_id, contract_id, shipment_no)
         select '${A}', id, 'JC-S-0001' from sales_contracts where tenant_id='${A}';`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, A's shipment is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string; shipment_no: string }>(
        `select tenant_id, shipment_no from export_shipments;`,
      ),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
    expect(rows[0].shipment_no).toBe("JC-S-0001");
  });

  it("as tenant B, A's shipment is invisible (no cross-tenant read)", async () => {
    const rows = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from export_shipments where tenant_id = '${A}';`),
    );
    expect(rows).toHaveLength(0);
  });
});
