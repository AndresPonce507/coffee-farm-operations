import { describe, expect, it } from "vitest";
import { validateTask } from "@/lib/validation/tasks";

const valid = {
  title: "Scout for broca",
  category: "Pest Control",
  plotId: "p-paso-ancho",
  workerId: "w-02",
  due: "2026-06-25",
  status: "todo",
  priority: "high",
};

describe("validateTask", () => {
  it("accepts a well-formed task and trims/normalizes it", () => {
    const res = validateTask({ ...valid, title: "  Scout for broca  " });
    expect(res).toEqual({
      ok: true,
      data: {
        title: "Scout for broca",
        category: "Pest Control",
        plotId: "p-paso-ancho",
        workerId: "w-02",
        due: "2026-06-25",
        status: "todo",
        priority: "high",
      },
    });
  });

  it("treats an empty plot as null (farm-wide work)", () => {
    const res = validateTask({ ...valid, plotId: "" });
    expect(res.ok && res.data.plotId).toBeNull();
  });

  it("rejects an empty title", () => {
    const res = validateTask({ ...valid, title: "   " });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.title).toBeTruthy();
  });

  it("rejects an unknown category / status / priority", () => {
    expect(validateTask({ ...valid, category: "Nonsense" }).ok).toBe(false);
    expect(validateTask({ ...valid, status: "almost" }).ok).toBe(false);
    expect(validateTask({ ...valid, priority: "urgent" }).ok).toBe(false);
  });

  it("requires an assignee and a valid ISO due date", () => {
    expect(validateTask({ ...valid, workerId: "" }).ok).toBe(false);
    expect(validateTask({ ...valid, due: "June 25" }).ok).toBe(false);
    expect(validateTask({ ...valid, due: "2026-6-5" }).ok).toBe(false);
  });
});
