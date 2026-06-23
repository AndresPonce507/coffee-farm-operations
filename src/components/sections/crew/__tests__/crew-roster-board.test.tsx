import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CrewRosterBoard } from "@/components/sections/crew/crew-roster-board";
import type { CrewRosterMember, WorkerCert } from "@/lib/db/people";

afterEach(cleanup);

function member(over: Partial<CrewRosterMember> = {}): CrewRosterMember {
  return {
    workerId: "w-1",
    name: "Rosa Quintero",
    role: "Picker",
    crewName: "Cuadrilla Volcán",
    crewId: "c-1",
    attendance: "present",
    preferredName: null,
    comarcaOrigin: null,
    languages: [],
    rehireEligible: true,
    ...over,
  };
}

const CERT: WorkerCert = {
  workerId: "w-1",
  certKind: "First aid",
  issuedAt: "2026-01-01",
  expiresAt: "2027-01-01",
  issuer: "Cruz Roja",
};

describe("CrewRosterBoard", () => {
  it("renders a crew column header and a member name", () => {
    render(<CrewRosterBoard members={[member()]} />);
    expect(
      screen.getByRole("heading", { name: "Cuadrilla Volcán" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rosa Quintero")).toBeInTheDocument();
  });

  it("groups members into separate crew columns", () => {
    render(
      <CrewRosterBoard
        members={[
          member({ workerId: "w-1", crewName: "Cuadrilla Volcán" }),
          member({
            workerId: "w-2",
            name: "Esteban Mora",
            crewName: "Cuadrilla Río Sereno",
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText("Cuadrilla Volcán crew")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Cuadrilla Río Sereno crew"),
    ).toBeInTheDocument();
  });

  it("shows a comarca chip when the member has an origin", () => {
    render(
      <CrewRosterBoard
        members={[member({ comarcaOrigin: "Ngäbe-Buglé" })]}
      />,
    );
    const chip = screen.getByTestId("comarca-w-1");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("Ngäbe-Buglé");
  });

  it("renders an attendance state on each worker card (not colour alone)", () => {
    render(<CrewRosterBoard members={[member({ attendance: "rest-day" })]} />);
    const card = screen.getByTestId("worker-card-w-1");
    expect(card).toHaveAttribute("data-attendance", "rest-day");
    // The state is carried by a readable label, not only the dot's colour.
    expect(within(card).getByText(/día de descanso|Rest day/i)).toBeInTheDocument();
  });

  it("renders a valid-cert badge from the certs map", () => {
    render(
      <CrewRosterBoard
        members={[member()]}
        certsByWorker={{ "w-1": [CERT] }}
      />,
    );
    const card = screen.getByTestId("worker-card-w-1");
    expect(within(card).getByText("1 cert")).toBeInTheDocument();
  });

  it("shows the es · ngäbere language chip for ngäbere speakers", () => {
    render(
      <CrewRosterBoard
        members={[member({ languages: ["es", "ngäbere"] })]}
      />,
    );
    expect(screen.getByTestId("lang-w-1")).toHaveTextContent("es · ngäbere");
  });

  // The es · ngäbere chip is the single affordance built for a ~90% Ngäbe-Buglé
  // crew, so its foreground/background MUST clear WCAG-AA for normal text
  // (>= 4.5:1) — the component doc-comment promises "WCAG-AA on glass" and the
  // chip's font is 11px/medium (well under the large-text cutoff). This computes
  // the real contrast from the resolved theme tokens the chip's Tailwind classes
  // map to, so it fails loudly if the chip ever drifts back to a failing pair.
  it("renders the es · ngäbere chip with WCAG-AA contrast (>= 4.5:1)", () => {
    // Resolved @theme tokens (src/app/globals.css). Tailwind v4 maps
    // bg-<t>/text-<t> -> var(--color-<t>); jsdom does not apply the stylesheet,
    // so we resolve the chip's color classes against the token table here.
    const TOKEN_HEX: Record<string, string> = {
      "sky": "#3b6ea5",
      "sky-100": "#d8e4f0",
      "muted": "#f2ece2",
      "muted-fg": "#6c6155",
      "coffee": "#45361f",
      "coffee-200": "#d8c7ad",
    };

    const srgbToLin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const n = hex.replace("#", "");
      const r = parseInt(n.slice(0, 2), 16);
      const g = parseInt(n.slice(2, 4), 16);
      const b = parseInt(n.slice(4, 6), 16);
      return (
        0.2126 * srgbToLin(r) +
        0.7152 * srgbToLin(g) +
        0.0722 * srgbToLin(b)
      );
    };
    const contrast = (a: string, b: string) => {
      const la = luminance(a);
      const lb = luminance(b);
      const [hi, lo] = la > lb ? [la, lb] : [lb, la];
      return (hi + 0.05) / (lo + 0.05);
    };

    render(
      <CrewRosterBoard members={[member({ languages: ["es", "ngäbere"] })]} />,
    );
    const chip = screen.getByTestId("lang-w-1");
    const classes = chip.className.split(/\s+/);

    // Resolve a color token for a Tailwind prefix, skipping non-color utilities
    // that share it (e.g. text-[11px], text-medium) by keeping only candidates
    // whose token is a known palette entry.
    const tokenFromClass = (prefix: string) => {
      const candidates = classes
        .filter((c) => c.startsWith(prefix))
        // Strip the prefix and any opacity modifier (e.g. bg-coffee-200/50).
        .map((c) => c.slice(prefix.length).split("/")[0]);
      return candidates.find((t) => t in TOKEN_HEX);
    };

    const bgToken = tokenFromClass("bg-");
    const fgToken = tokenFromClass("text-");
    expect(bgToken, "chip has no resolvable bg color token").toBeDefined();
    expect(fgToken, "chip has no resolvable text color token").toBeDefined();

    const bgHex = TOKEN_HEX[bgToken!];
    const fgHex = TOKEN_HEX[fgToken!];
    // Guard: the chip's tokens must be ones we can resolve, else the assertion
    // would silently no-op on a future class swap.
    expect(bgHex, `unknown bg token "${bgToken}"`).toBeDefined();
    expect(fgHex, `unknown fg token "${fgToken}"`).toBeDefined();

    const ratio = contrast(fgHex, bgHex);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("renders an empty state when there are no crews", () => {
    render(<CrewRosterBoard members={[]} />);
    expect(screen.getByText("No crews on the roster")).toBeInTheDocument();
  });

  it("worker name/avatar block is wrapped in an EntityLink to /workers/[workerId]", () => {
    render(<CrewRosterBoard members={[member()]} />);
    const card = screen.getByTestId("worker-card-w-1");
    // The worker name must be inside an <a> that navigates to the worker dossier.
    const link = within(card).getByRole("link", { name: /abrir worker w-1/i });
    expect(link).toHaveAttribute("href", "/workers/w-1");
  });

  it("crew column header h3 is wrapped in an EntityLink to /crew/[crewId]", () => {
    render(<CrewRosterBoard members={[member({ crewId: "c-1" })]} />);
    // The crew heading must be navigable.
    const link = screen.getByRole("link", { name: /abrir crew c-1/i });
    expect(link).toHaveAttribute("href", "/crew/c-1");
    expect(within(link).getByRole("heading", { name: "Cuadrilla Volcán" })).toBeInTheDocument();
  });

  it("crew column header skips the EntityLink when crewId is null (legacy unassigned)", () => {
    render(<CrewRosterBoard members={[member({ crewId: null })]} />);
    // The heading still renders but without a link.
    expect(screen.getByRole("heading", { name: "Cuadrilla Volcán" })).toBeInTheDocument();
    // No crew link should be present.
    expect(screen.queryByRole("link", { name: /abrir crew/i })).toBeNull();
  });
});
