import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the GreenLot inventory Server Actions (S5). Server Actions
 * are the driving port (ADR-002 — only ever invoked by an authenticated human
 * submitting a form). These tests drive the actions with real `FormData` against
 * a mocked Supabase client + a mocked `revalidatePath`, proving:
 *   - the action builds the offline-ready envelope server-side (synthetic
 *     `occurredAt` when the form omits it) and delegates to the command,
 *   - a successful grade revalidates `/inventory` and returns the green code,
 *   - the fail-closed oversell guard surfaces as a CLEAN error in the action
 *     state (the family never sees a raw Postgres exception),
 *   - validation failures are returned as field errors without a round-trip.
 *
 * Mirrors the supabase-server mock idiom in src/lib/db/__tests__/lots.test.ts.
 */

const getSupabaseMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePathMock(p),
}));

import {
  gradeGreenLotAction,
  reserveGreenLotAction,
  INVENTORY_IDLE,
} from "@/app/(app)/inventory/actions";

/**
 * A Supabase-client stand-in: `.rpc()` for grading (and the best-effort
 * `refresh_lot_cost` reprice after a successful grade), `.from().insert()` for
 * reserve. The grade path now issues TWO `.rpc()` calls on success —
 * `materialize_green_lot` then `refresh_lot_cost` — so the stub dispatches by
 * function name (the materialize result is configurable; the refresh defaults to
 * a clean no-op, and an explicit `refresh` result lets a test force it to error).
 */
function makeClient(opts: {
  rpc?: { data: string | null; error: { message: string } | null };
  refresh?: { data: unknown; error: { message: string } | null };
  insert?: { data: unknown; error: { message: string; code?: string } | null };
}): {
  client: unknown;
  rpc: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn((fn: string) => {
    if (fn === "refresh_lot_cost") {
      return Promise.resolve(opts.refresh ?? { data: null, error: null });
    }
    return Promise.resolve(opts.rpc ?? { data: null, error: null });
  });
  const insert = vi.fn(() =>
    Promise.resolve(opts.insert ?? { data: null, error: null }),
  );
  const from = vi.fn(() => ({ insert }));
  return { client: { rpc, from }, rpc, insert };
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────── exports ───────────────────────────────────────

describe("inventory action module", () => {
  it("exposes an idle state", () => {
    expect(INVENTORY_IDLE.status).toBe("idle");
  });
});

// ─────────────────────────── grade action ──────────────────────────────────

describe("gradeGreenLotAction", () => {
  it("grades a lot (NO green code — server-minted), revalidates, returns the MINTED code", async () => {
    const { client, rpc } = makeClient({
      rpc: { data: "JC-572", error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await gradeGreenLotAction(
      INVENTORY_IDLE,
      form({
        sourceCode: "JC-564",
        kg: "240",
        cuppingScore: "88.5",
        location: "Warehouse A",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    // materialize_green_lot is called with a NULL code so the RPC mints identity.
    const mat = rpc.mock.calls.find((c) => c[0] === "materialize_green_lot");
    expect(mat).toBeDefined();
    expect((mat![1] as Record<string, unknown>).p_green_code).toBeNull();

    expect(state.status).toBe("success");
    if (state.status === "success") {
      expect(state.greenLotCode).toBe("JC-572");
    }
    expect(revalidatePathMock).toHaveBeenCalledWith("/inventory");
  });

  it("refreshes the new green lot's COGS after a successful grade (refresh_lot_cost)", async () => {
    const { client, rpc } = makeClient({
      rpc: { data: "JC-572", error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    await gradeGreenLotAction(
      INVENTORY_IDLE,
      form({
        sourceCode: "JC-564",
        kg: "240",
        cuppingScore: "88.5",
        location: "Warehouse A",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    // The new lot is costed immediately so it isn't uncosted until an unrelated refresh.
    expect(rpc.mock.calls.some((c) => c[0] === "refresh_lot_cost")).toBe(true);
  });

  it("still SUCCEEDS when the best-effort COGS refresh errors (never fails the grade)", async () => {
    const { client } = makeClient({
      rpc: { data: "JC-572", error: null },
      refresh: { data: null, error: { message: "refresh boom" } },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await gradeGreenLotAction(
      INVENTORY_IDLE,
      form({
        sourceCode: "JC-564",
        kg: "240",
        cuppingScore: "88.5",
        location: "Warehouse A",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(state.status).toBe("success");
    if (state.status === "success") expect(state.greenLotCode).toBe("JC-572");
    expect(revalidatePathMock).toHaveBeenCalledWith("/inventory");
  });

  it("does NOT refresh COGS when the grade itself fails", async () => {
    const { client, rpc } = makeClient({
      rpc: { data: null, error: { message: "mass conservation: exceeds available mass" } },
    });
    getSupabaseMock.mockReturnValue(client);

    await gradeGreenLotAction(
      INVENTORY_IDLE,
      form({
        sourceCode: "JC-564",
        kg: "9999",
        cuppingScore: "88.5",
        location: "Warehouse A",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(rpc.mock.calls.some((c) => c[0] === "refresh_lot_cost")).toBe(false);
  });

  it("synthesizes occurredAt server-side when the form omits it", async () => {
    const { client, rpc } = makeClient({
      rpc: { data: "JC-572", error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    await gradeGreenLotAction(
      INVENTORY_IDLE,
      form({
        sourceCode: "JC-564",
        kg: "240",
        cuppingScore: "88.5",
        location: "Warehouse A",
        // occurredAt intentionally omitted
      }),
    );

    const mat = rpc.mock.calls.find((c) => c[0] === "materialize_green_lot");
    const args = mat![1] as Record<string, unknown>;
    expect(typeof args.p_occurred_at).toBe("string");
    expect(args.p_occurred_at).not.toBe("");
    // A real, parseable ISO timestamp was filled in.
    expect(Number.isFinite(Date.parse(args.p_occurred_at as string))).toBe(true);
  });

  it("returns field errors WITHOUT a round-trip on invalid input", async () => {
    const { client, rpc } = makeClient({});
    getSupabaseMock.mockReturnValue(client);

    const state = await gradeGreenLotAction(
      INVENTORY_IDLE,
      form({
        sourceCode: "",
        kg: "240",
        cuppingScore: "88.5",
        location: "Warehouse A",
      }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.errors?.sourceCode).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a FRIENDLY error (no raw PG) when over-routing is rejected", async () => {
    const { client } = makeClient({
      rpc: {
        data: null,
        error: { message: "mass conservation: exceeds available mass" },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await gradeGreenLotAction(
      INVENTORY_IDLE,
      form({
        sourceCode: "JC-564",
        kg: "9999",
        cuppingScore: "88.5",
        location: "Warehouse A",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/available|exceed|enough|lower/i);
      // Raw Postgres / function-name text must never leak.
      expect(state.message).not.toMatch(/materialize_green_lot|conservation/);
    }
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── reserve action ────────────────────────────────

describe("reserveGreenLotAction", () => {
  it("reserves kg, revalidates /inventory, and reports success", async () => {
    const { client, insert } = makeClient({
      insert: { data: [{ id: 1 }], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await reserveGreenLotAction(
      INVENTORY_IDLE,
      form({ greenLotCode: "JC-564-G", buyer: "Onyx Coffee Lab", kg: "60" }),
    );

    expect(insert).toHaveBeenCalledWith({
      green_lot_code: "JC-564-G",
      buyer: "Onyx Coffee Lab",
      kg: 60,
    });
    expect(state.status).toBe("success");
    expect(revalidatePathMock).toHaveBeenCalledWith("/inventory");
  });

  it("surfaces the fail-closed oversell guard as a CLEAN error (no raw exception)", async () => {
    const { client } = makeClient({
      insert: {
        data: null,
        error: {
          message:
            "oversell guard: committing 60 kg to green lot JC-564-G would exceed its 50 kg available-to-promise (40 already committed)",
          code: "23514",
        },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await reserveGreenLotAction(
      INVENTORY_IDLE,
      form({ greenLotCode: "JC-564-G", buyer: "Onyx Coffee Lab", kg: "60" }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/available|enough|oversell|exceed/i);
      expect(state.message).toContain("JC-564-G");
    }
    // A rejected reservation does NOT revalidate (nothing changed).
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns field errors WITHOUT a round-trip on invalid input", async () => {
    const { client, insert } = makeClient({});
    getSupabaseMock.mockReturnValue(client);

    const state = await reserveGreenLotAction(
      INVENTORY_IDLE,
      form({ greenLotCode: "JC-564-G", buyer: "", kg: "60" }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.errors?.buyer).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
