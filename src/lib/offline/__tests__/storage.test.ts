import { beforeEach, describe, expect, it } from "vitest";

import {
  createMemoryStore,
  type OutboxStore,
} from "@/lib/offline/storage";

/**
 * The outbox depends on a narrow async key-value port (`OutboxStore`) — the
 * same ports-and-adapters discipline the command write-doors use. The
 * IndexedDB adapter is one implementation; an in-memory store is the test
 * double (so the outbox logic is provable in jsdom with ZERO new deps and no
 * fake-indexeddb). This test pins the port's contract so both adapters honor it.
 */
describe("OutboxStore (memory adapter — the port contract)", () => {
  let store: OutboxStore;

  beforeEach(() => {
    store = createMemoryStore();
  });

  it("put then get round-trips a record by key", async () => {
    await store.put("k1", { uuid: "k1", n: 1 });
    expect(await store.get("k1")).toEqual({ uuid: "k1", n: 1 });
  });

  it("get of a missing key resolves undefined", async () => {
    expect(await store.get("nope")).toBeUndefined();
  });

  it("getAll returns every record in insertion order", async () => {
    await store.put("a", { uuid: "a" });
    await store.put("b", { uuid: "b" });
    await store.put("c", { uuid: "c" });
    const all = await store.getAll();
    expect(all.map((r) => (r as { uuid: string }).uuid)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("put with an existing key updates in place, preserving order", async () => {
    await store.put("a", { uuid: "a", v: 1 });
    await store.put("b", { uuid: "b", v: 1 });
    await store.put("a", { uuid: "a", v: 2 });
    const all = (await store.getAll()) as { uuid: string; v: number }[];
    expect(all.map((r) => r.uuid)).toEqual(["a", "b"]);
    expect(all.find((r) => r.uuid === "a")?.v).toBe(2);
  });

  it("delete removes a record", async () => {
    await store.put("a", { uuid: "a" });
    await store.delete("a");
    expect(await store.get("a")).toBeUndefined();
    expect(await store.getAll()).toEqual([]);
  });
});
