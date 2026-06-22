import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActionState } from "@/lib/actions/workers";

// WorkerForm only needs IDLE from the actions module at runtime; stub it so the
// form renders without importing next/cache or the Supabase client.
vi.mock("@/lib/actions/workers", () => ({ IDLE: { status: "idle" } }));

import { WorkerForm } from "@/components/sections/workers/worker-form";

const noop = async (): Promise<ActionState> => ({ status: "idle" });

// Crew names now arrive as a prop, sourced LIVE from getCrews() by the RSC parent
// (no more hardcoded CREWS const import inside the form).
const CREW_NAMES = ["Crew Norte", "Field Ops"];

describe("WorkerForm (smoke)", () => {
  it("renders the worker fields and the submit label", () => {
    render(
      <WorkerForm
        action={noop}
        submitLabel="Add worker"
        onDone={() => {}}
        crews={CREW_NAMES}
      />,
    );

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(screen.getByLabelText("Crew")).toBeInTheDocument();
    expect(screen.getByLabelText("Day rate (USD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Started year")).toBeInTheDocument();
    expect(screen.getByLabelText("Attendance")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();

    // today_kg must NOT be on the form (it becomes a computed view later).
    expect(screen.queryByLabelText(/today/i)).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Add worker" }),
    ).toBeInTheDocument();

    // The crew select is populated from the live `crews` prop.
    expect(
      screen.getByRole("option", { name: "Crew Norte" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Field Ops" }),
    ).toBeInTheDocument();
    // A role option from WORKER_ROLES renders.
    expect(
      screen.getByRole("option", { name: "Agronomist" }),
    ).toBeInTheDocument();
  });
});
