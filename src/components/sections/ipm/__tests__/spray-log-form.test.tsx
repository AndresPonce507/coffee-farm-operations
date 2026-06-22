import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SprayLogForm } from "@/components/sections/ipm/spray-log-form";
import type { CertifiedApplicator, PlotOption } from "@/components/sections/ipm/spray-log-form";
import type { SprayStore } from "@/lib/db/commands/logSpray";

/**
 * Render/interaction test for the cert-gated spray-log form (P2-S12) — the UI half
 * of the slice's keystone invariant. The DB `log_spray` is the REAL fail-closed
 * gate; the form's job is to make that gate VISIBLE and refuse to submit an
 * uncertified applicator BEFORE the round-trip, so the field worker gets an
 * immediate, dignified "you need a valid cert" rather than a cryptic DB error.
 */

afterEach(cleanup);

const plots: PlotOption[] = [
  { id: "p-talamanca", name: "Talamanca" },
  { id: "p-cuesta-piedra", name: "Cuesta de Piedra" },
];

const applicators: CertifiedApplicator[] = [
  { id: "w-agro", name: "Lucía Mendez", certified: true },
  { id: "w-06", name: "Ana Pérez", certified: false }, // NO valid pesticide cert
];

/** A `SprayStore` whose single `.rpc('log_spray', …)` method is a spy. */
type MockStore = { rpc: ReturnType<typeof vi.fn> } & SprayStore;

/** A store that resolves like a successful `log_spray` (returns a spray id). */
function okStore(): MockStore {
  return {
    rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
  };
}

describe("SprayLogForm (cert-gate UI)", () => {
  it("renders the form with a product field and an applicator picker", () => {
    render(<SprayLogForm plots={plots} applicators={applicators} />);
    expect(screen.getByLabelText(/product/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/applicator|worker/i)).toBeInTheDocument();
  });

  it("marks an uncertified applicator option as such (the cert state is visible)", () => {
    render(<SprayLogForm plots={plots} applicators={applicators} />);
    // the uncertified worker is flagged in the picker (e.g. disabled option / "no cert")
    const picker = screen.getByLabelText(/applicator|worker/i) as HTMLSelectElement;
    const uncertOption = within(picker).getByRole("option", { name: /Ana Pérez/i }) as HTMLOptionElement;
    expect(uncertOption.disabled).toBe(true);
  });

  it("REFUSES to submit when the chosen applicator lacks a valid cert — shows the gate reason", () => {
    render(<SprayLogForm plots={plots} applicators={applicators} />);

    // force-select the uncertified worker (the value the gate must catch) and submit.
    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: "Verdadero 600" } });
    fireEvent.change(screen.getByLabelText(/applicator|worker/i), { target: { value: "w-06" } });
    fireEvent.submit(screen.getByTestId("spray-form"));

    // the form blocks it client-side with a clear cert reason — the dignified refusal.
    expect(screen.getByRole("alert")).toHaveTextContent(/cert|certif|valid/i);
  });

  it("allows a certified applicator to be chosen without the cert error", () => {
    const store = okStore();
    render(<SprayLogForm plots={plots} applicators={applicators} store={store} />);
    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: "Verdadero 600" } });
    fireEvent.change(screen.getByLabelText(/applicator|worker/i), { target: { value: "w-agro" } });
    fireEvent.submit(screen.getByTestId("spray-form"));
    // no cert refusal for a certified applicator (other validation may apply, but
    // not the cert gate).
    const alert = screen.queryByRole("alert");
    if (alert) expect(alert).not.toHaveTextContent(/lacks a valid|not certified|no valid cert/i);
  });

  // ── the write half: the form must actually call log_spray, not fake success ──

  it("collects the PHI/REI/active-ingredient/applied-at dossier fields the RPC requires", () => {
    render(<SprayLogForm plots={plots} applicators={applicators} />);
    expect(screen.getByLabelText(/active ingredient/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PHI/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/REI/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/applied/i)).toBeInTheDocument();
  });

  it("WRITES: a valid certified submit calls log_spray exactly once with the full snake_case envelope", async () => {
    const store = okStore();
    render(<SprayLogForm plots={plots} applicators={applicators} store={store} />);

    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: "Verdadero 600" } });
    fireEvent.change(screen.getByLabelText(/active ingredient/i), { target: { value: "cyproconazole" } });
    fireEvent.change(screen.getByLabelText(/PHI/i), { target: { value: "21" } });
    fireEvent.change(screen.getByLabelText(/REI/i), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/applied/i), { target: { value: "2026-06-20T08:00" } });
    fireEvent.change(screen.getByLabelText(/applicator|worker/i), { target: { value: "w-agro" } });
    fireEvent.submit(screen.getByTestId("spray-form"));

    await waitFor(() => expect(store.rpc).toHaveBeenCalledTimes(1));
    const [fn, args] = store.rpc.mock.calls[0];
    expect(fn).toBe("log_spray");
    expect(args).toMatchObject({
      p_plot_id: "p-talamanca",
      p_product: "Verdadero 600",
      p_active_ingredient: "cyproconazole",
      p_phi_days: 21,
      p_rei_hours: 12,
      p_worker_id: "w-agro",
    });
    expect(typeof args.p_applied_at).toBe("string");
    expect(args.p_applied_at).not.toBe("");
    expect(typeof args.p_idempotency_key).toBe("string");
    expect(args.p_idempotency_key.length).toBeGreaterThan(0);
  });

  it("shows the 'Spray logged — PHI/REI windows stamped' success ONLY after the RPC returns a spray id", async () => {
    const store = okStore();
    render(<SprayLogForm plots={plots} applicators={applicators} store={store} />);

    // before submit: no success banner (the old stub showed it without writing).
    expect(screen.queryByText(/windows stamped/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: "Verdadero 600" } });
    fireEvent.change(screen.getByLabelText(/applied/i), { target: { value: "2026-06-20T08:00" } });
    fireEvent.change(screen.getByLabelText(/applicator|worker/i), { target: { value: "w-agro" } });
    fireEvent.submit(screen.getByTestId("spray-form"));

    await waitFor(() =>
      expect(screen.getByText(/windows stamped/i)).toBeInTheDocument(),
    );
  });

  it("surfaces the DB cert/PHI/REI refusal as an error and does NOT show success", async () => {
    const store: MockStore = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "spray gate: applicator lacks a valid cert" },
      }),
    };
    render(<SprayLogForm plots={plots} applicators={applicators} store={store} />);

    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: "Verdadero 600" } });
    fireEvent.change(screen.getByLabelText(/applied/i), { target: { value: "2026-06-20T08:00" } });
    fireEvent.change(screen.getByLabelText(/applicator|worker/i), { target: { value: "w-agro" } });
    fireEvent.submit(screen.getByTestId("spray-form"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/cert|gate|refus/i),
    );
    expect(screen.queryByText(/windows stamped/i)).not.toBeInTheDocument();
  });

  it("warns honestly when NO applicator on the crew holds a valid cert (the work cannot be logged)", () => {
    render(
      <SprayLogForm
        plots={plots}
        applicators={[{ id: "w-06", name: "Ana Pérez", certified: false }]}
      />,
    );
    // the prominent status banner names the gap and disables the submit.
    expect(screen.getByRole("status")).toHaveTextContent(/no crew member holds a valid/i);
    expect(screen.getByRole("button", { name: /log spray/i })).toBeDisabled();
  });
});
