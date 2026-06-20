import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppError from "@/app/(app)/error";

describe("(app) route error boundary", () => {
  it("renders a calm, on-brand message instead of a raw stack trace", () => {
    render(
      <AppError
        error={new Error("getSupabase: missing env (project paused)")}
        reset={vi.fn()}
      />
    );

    // Friendly headline, not the raw error message.
    expect(
      screen.getByText("We couldn't load the farm data right now")
    ).toBeInTheDocument();

    // The raw Supabase error string is NOT surfaced to the user.
    expect(screen.queryByText(/getSupabase/)).toBeNull();
  });

  it("calls reset() when 'Try again' is clicked", () => {
    const reset = vi.fn();
    render(<AppError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
