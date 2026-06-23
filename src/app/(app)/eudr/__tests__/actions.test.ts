import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the EUDR declaration Server Action (S8 — the WRITE seam).
 * Server Actions are the driving port (ADR-002 — only ever invoked by an
 * authenticated human submitting a form). It drives the action against a mocked
 * Supabase client + mocked `revalidatePath`, proving:
 *   - a deforestation-free declaration calls `eudr_declare_plot` with the right
 *     p_plot_id / p_free / p_basis args and revalidates the lot + /eudr pages,
 *   - a withdraw (p_free=false) clears the basis (passes null) and still writes,
 *   - the DB CHECK violations (basis-required, established-pre-cutoff) surface as
 *     CLEAN, friendly errors (the family never sees a raw Postgres exception) and
 *     do NOT revalidate,
 *   - an unknown-plot error surfaces gracefully.
 *
 * Mirrors the supabase-server mock idiom in src/lib/db/__tests__/eudr.test.ts and
 * src/app/(app)/inventory/__tests__/actions.test.ts.
 */

const getSupabaseMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

import { declarePlotDeforestationFree } from "@/app/(app)/eudr/actions";

/** A Supabase-client stand-in whose single `.rpc()` resolves the given result. */
function makeClient(result: {
  data: unknown;
  error: { message: string; code?: string } | null;
}): { client: unknown; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { client: { rpc }, rpc };
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("declarePlotDeforestationFree", () => {
  it("declares a plot free, passes the right RPC args, and revalidates the lot + /eudr", async () => {
    const { client, rpc } = makeClient({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const res = await declarePlotDeforestationFree(
      "p-baru-vista",
      true,
      "established-pre-cutoff",
      "JC-701",
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("eudr_declare_plot", {
      p_plot_id: "p-baru-vista",
      p_free: true,
      p_basis: "established-pre-cutoff",
    });
    expect(res).toEqual({ ok: true });
    // reactiveRefresh("eudr-declaration") fans out to both /eudr and /lots/[code]
    // (the route-segment pattern, not the concrete lot path).
    expect(revalidatePathMock).toHaveBeenCalledWith("/eudr");
    expect(revalidatePathMock).toHaveBeenCalledWith("/lots/[code]");
  });

  it("withdraws a declaration (p_free=false) with a null basis and still revalidates", async () => {
    const { client, rpc } = makeClient({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const res = await declarePlotDeforestationFree("p-baru-vista", false, null);

    expect(rpc).toHaveBeenCalledWith("eudr_declare_plot", {
      p_plot_id: "p-baru-vista",
      p_free: false,
      p_basis: null,
    });
    expect(res).toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/eudr");
  });

  it("rejects a free declaration with no basis WITHOUT a round-trip", async () => {
    const { client, rpc } = makeClient({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const res = await declarePlotDeforestationFree("p-baru-vista", true, null);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/basis/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces the established-pre-cutoff CHECK violation as a friendly message (no raw SQL)", async () => {
    const { client } = makeClient({
      data: null,
      error: {
        message:
          'new row for relation "plots" violates check constraint "plots_eudr_pre_cutoff_chk"',
        code: "23514",
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const res = await declarePlotDeforestationFree(
      "p-young",
      true,
      "established-pre-cutoff",
      "JC-701",
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/2020|cutoff|established/i);
      expect(res.error).not.toMatch(/check constraint|plots_eudr/i);
    }
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces the basis-required CHECK violation as a friendly message", async () => {
    const { client } = makeClient({
      data: null,
      error: {
        message:
          "a deforestation-free declaration requires a basis",
        code: "23514",
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const res = await declarePlotDeforestationFree("p-baru-vista", true, "field-survey");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/basis/i);
  });

  it("surfaces an unknown-plot error gracefully", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "unknown plot p-ghost", code: "23503" },
    });
    getSupabaseMock.mockReturnValue(client);

    const res = await declarePlotDeforestationFree("p-ghost", true, "field-survey");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/plot|found|exist/i);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("revalidates the /eudr overview even when no lotCode is given", async () => {
    const { client } = makeClient({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    await declarePlotDeforestationFree("p-baru-vista", true, "satellite-monitoring");

    expect(revalidatePathMock).toHaveBeenCalledWith("/eudr");
    // reactiveRefresh always fans out to the /lots/[code] route segment pattern.
    expect(revalidatePathMock).toHaveBeenCalledWith("/lots/[code]");
  });
});
