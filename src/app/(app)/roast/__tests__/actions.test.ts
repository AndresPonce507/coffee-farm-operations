import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The roast Server Actions are the one driving port: validate the shape the DB
// enforces, append through a single SECURITY DEFINER RPC, surface author-written
// guard messages verbatim, and fan a green-inventory move out through the RIPPLE
// SSOT. Mock the Supabase client + the revalidate spine so these run with no network.
const getSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

const reactiveRefreshMock = vi.fn();
vi.mock("@/lib/revalidate", () => ({
  reactiveRefresh: (kind: string) => reactiveRefreshMock(kind),
}));

import {
  createRoastProfileAction,
  finalizeRoastBatchAction,
  importRoastAlogAction,
  linkRoastSkuAction,
  lockRoastProfileAction,
  openRoastBatchAction,
} from "@/app/(app)/roast/actions";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

function makeClient(byName: Record<string, RpcResult> = {}) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(byName[name] ?? { data: null, error: null }),
  );
  return { client: { rpc }, rpc };
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  reactiveRefreshMock.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("roast Server Actions", () => {
  it("create_roast_profile: sends the p_* envelope and returns the new profile id", async () => {
    const { client, rpc } = makeClient({
      create_roast_profile: { data: 7, error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await createRoastProfileAction({
      name: "Geisha Filter",
      variety: "Geisha",
      roastLevel: "medium-light",
      chargeTempC: 200,
      dropTempC: 205,
      totalTimeS: 600,
      dtrPct: 22,
      idempotencyKey: "k1",
    });

    expect(result).toEqual({ ok: true, profileId: 7 });
    expect(rpc).toHaveBeenCalledWith("create_roast_profile", {
      p_name: "Geisha Filter",
      p_variety: "Geisha",
      p_roast_level: "medium-light",
      p_target_charge_temp_c: 200,
      p_target_drop_temp_c: 205,
      p_target_total_time_s: 600,
      p_target_dtr_pct: 22,
      p_idempotency_key: "k1",
    });
    // Authoring a draft moves NO green inventory — nothing ripples.
    expect(reactiveRefreshMock).not.toHaveBeenCalled();
  });

  it("create_roast_profile: rejects an empty name BEFORE any round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createRoastProfileAction({
      name: "   ",
      variety: null,
      roastLevel: "medium",
      chargeTempC: 200,
      dropTempC: 205,
      totalTimeS: 600,
      dtrPct: null,
      idempotencyKey: "k2",
    });

    expect(result).toEqual({ ok: false, error: "Enter a profile name." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lock_roast_profile: returns the new status and does NOT ripple (status-only)", async () => {
    const { client, rpc } = makeClient({
      lock_roast_profile: { data: "approved", error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await lockRoastProfileAction({ profileId: 7, idempotencyKey: "k3" });

    expect(result).toEqual({ ok: true, status: "approved" });
    expect(rpc).toHaveBeenCalledWith("lock_roast_profile", {
      p_profile_id: 7,
      p_idempotency_key: "k3",
    });
    expect(reactiveRefreshMock).not.toHaveBeenCalled();
  });

  it("open_roast_batch: sends the envelope, returns the batch id, and ripples inventory (the green draw moves ATP)", async () => {
    const { client, rpc } = makeClient({
      open_roast_batch: { data: 11, error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await openRoastBatchAction({
      greenLotCode: "JC-701",
      profileId: 7,
      roasterId: 1,
      greenInKg: 12,
      idempotencyKey: "k4",
    });

    expect(result).toEqual({ ok: true, batchId: 11 });
    expect(rpc).toHaveBeenCalledWith("open_roast_batch", {
      p_green_lot_code: "JC-701",
      p_profile_id: 7,
      p_roaster_id: 1,
      p_green_in_kg: 12,
      p_idempotency_key: "k4",
    });
    expect(reactiveRefreshMock).toHaveBeenCalledWith("inventory-update");
  });

  it("open_roast_batch: surfaces the golden-gate guard message verbatim (check_violation)", async () => {
    const { client } = makeClient({
      open_roast_batch: {
        data: null,
        error: {
          code: "23514",
          message:
            "roast profile 7 is draft — only a GOLDEN (approved) profile can be roasted against",
        },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await openRoastBatchAction({
      greenLotCode: "JC-701",
      profileId: 7,
      roasterId: 1,
      greenInKg: 12,
      idempotencyKey: "k5",
    });

    expect(result).toEqual({
      ok: false,
      error:
        "roast profile 7 is draft — only a GOLDEN (approved) profile can be roasted against",
    });
    // A failed write never ripples.
    expect(reactiveRefreshMock).not.toHaveBeenCalled();
  });

  it("import_roast_alog: forwards the payload + filename and returns the import id", async () => {
    const { client, rpc } = makeClient({
      import_roast_alog: { data: 3, error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const payload = { points: [{ t: 0, bt: 200 }], events: [] };

    const result = await importRoastAlogAction({
      batchId: 11,
      sourceFilename: "geisha.alog",
      payload,
      idempotencyKey: "k6",
    });

    expect(result).toEqual({ ok: true, importId: 3 });
    expect(rpc).toHaveBeenCalledWith("import_roast_alog", {
      p_batch_id: 11,
      p_source_filename: "geisha.alog",
      p_alog_payload: payload,
      p_idempotency_key: "k6",
    });
    // Recording capture evidence moves no inventory.
    expect(reactiveRefreshMock).not.toHaveBeenCalled();
  });

  it("finalize_roast_batch: sends the envelope, returns the minted roasted code, and ripples inventory (mass + cost moved)", async () => {
    const { client, rpc } = makeClient({
      finalize_roast_batch: { data: "JC-880", error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await finalizeRoastBatchAction({
      batchId: 11,
      roastedKgOut: 8.4,
      roastCostUsd: 24,
      location: "Roastery",
      idempotencyKey: "k7",
    });

    expect(result).toEqual({ ok: true, roastedLotCode: "JC-880" });
    expect(rpc).toHaveBeenCalledWith("finalize_roast_batch", {
      p_batch_id: 11,
      p_roasted_kg_out: 8.4,
      p_roast_cost_usd: 24,
      p_location: "Roastery",
      p_idempotency_key: "k7",
    });
    expect(reactiveRefreshMock).toHaveBeenCalledWith("inventory-update");
  });

  it("link_roast_sku: converts USD dollars to integer cents and returns the sku id", async () => {
    const { client, rpc } = makeClient({
      link_roast_sku: { data: 5, error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await linkRoastSkuAction({
      batchId: 11,
      skuCode: "JC-GEISHA-250",
      bagSizeG: 250,
      priceUsd: 28,
      gtin: "0123456789012",
      idempotencyKey: "k8",
    });

    expect(result).toEqual({ ok: true, skuId: 5 });
    expect(rpc).toHaveBeenCalledWith("link_roast_sku", {
      p_batch_id: 11,
      p_sku_code: "JC-GEISHA-250",
      p_bag_size_g: 250,
      p_price_usd_cents: 2800,
      p_gtin: "0123456789012",
      p_idempotency_key: "k8",
    });
  });

  it("link_roast_sku: a null price stays null (not 0 cents)", async () => {
    const { client, rpc } = makeClient({
      link_roast_sku: { data: 6, error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    await linkRoastSkuAction({
      batchId: 11,
      skuCode: "JC-NAT-250",
      bagSizeG: 250,
      priceUsd: null,
      gtin: null,
      idempotencyKey: "k9",
    });

    expect(rpc).toHaveBeenCalledWith(
      "link_roast_sku",
      expect.objectContaining({ p_price_usd_cents: null, p_gtin: null }),
    );
  });
});
