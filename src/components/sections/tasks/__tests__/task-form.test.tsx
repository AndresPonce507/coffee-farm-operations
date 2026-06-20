import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Plot, Worker } from "@/lib/types";
import type { ActionState } from "@/lib/actions/tasks";

// TaskForm only needs IDLE from the actions module at runtime; stub it so the
// form renders without importing next/cache or the Supabase client.
vi.mock("@/lib/actions/tasks", () => ({ IDLE: { status: "idle" } }));

import { TaskForm } from "@/components/sections/tasks/task-form";

const plots = [{ id: "p1", name: "Tizingal Alto" }] as unknown as Plot[];
const workers = [{ id: "w-02", name: "Janette Janson" }] as unknown as Worker[];
const noop = async (): Promise<ActionState> => ({ status: "idle" });

describe("TaskForm (smoke)", () => {
  it("renders the task fields and the submit label", () => {
    render(
      <TaskForm
        plots={plots}
        workers={workers}
        action={noop}
        submitLabel="Add task"
        onDone={() => {}}
      />,
    );

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee")).toBeInTheDocument();
    expect(screen.getByLabelText("Due")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Janette Janson" }),
    ).toBeInTheDocument();
  });
});
