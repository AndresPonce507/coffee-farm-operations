import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RippleProof } from "@/components/sections/weigh/ripple-proof";

afterEach(cleanup);

/**
 * RippleProof render tests (facet-01 §2 RippleProofProps; build-plan §2 test list).
 *
 * The walking-skeleton proof panel: it NAMES the real downstream consumers a single
 * capture just moved and links each as a real `<a href>`, with the captured Δ kg —
 * making "enter once, it shows up everywhere" visible and trustworthy. No re-fetch:
 * it RENDERS the propagation contract from the capture result alone.
 */
describe("RippleProof — the reactive proof panel", () => {
  it("names ≥2 consumers, each a real <a href>, and shows the captured +kg", () => {
    render(<RippleProof lotCode="JC-712" lastDeltaKg={18.4} />);

    // The captured delta is shown, formatted +NN.N kg (on each consumer row).
    expect(screen.getAllByText(/\+18\.4\s*kg/).length).toBeGreaterThanOrEqual(1);

    // ≥2 consumers, each a real navigable link.
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) {
      expect(a).toHaveAttribute("href");
      expect(a.getAttribute("href")).toMatch(/^\//); // real absolute app path
    }

    // The two named, immediate consumers from the §2 contract: Dashboard + lot dossier.
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/"); // Dashboard "today"
    expect(hrefs).toContain("/lots/JC-712"); // the minted lot dossier
  });

  it("links the lot dossier to /lots/<code> and names the lot", () => {
    render(<RippleProof lotCode="JC-908" lastDeltaKg={7.6} />);
    const lotLink = screen.getByRole("link", { name: /JC-908/ });
    expect(lotLink).toHaveAttribute("href", "/lots/JC-908");
  });

  it("each consumer line carries the propagated delta next to its link", () => {
    render(<RippleProof lotCode="JC-712" lastDeltaKg={18.4} />);
    // The Dashboard line shows the +Δ that just landed there.
    const dash = screen.getByRole("link", { name: /Dashboard|Tablero|hoy/i });
    // the delta text lives within the same consumer row as the dashboard link.
    const row = dash.closest("li") ?? dash.parentElement!;
    expect(within(row as HTMLElement).getByText(/\+18\.4\s*kg/)).toBeInTheDocument();
  });

  it("is es-PA-first (the panel headline reflects the capture landing)", () => {
    render(<RippleProof lotCode="JC-712" lastDeltaKg={18.4} />);
    // "Tu peso se reflejó en…" — the es-PA framing required by the spec.
    expect(screen.getByText(/se reflejó/i)).toBeInTheDocument();
  });

  it("degrades offline: no lot code → generic 'Tu lote' + the /lots index link, still ≥2 consumers", () => {
    render(<RippleProof lotCode={null} lastDeltaKg={18.4} />);

    // The captured kg is still shown (the picker's tally still climbed offline).
    expect(screen.getAllByText(/\+18\.4\s*kg/).length).toBeGreaterThanOrEqual(1);

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(2);
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/"); // Dashboard still linked
    // The lot code is unknown offline → the panel links the live /harvests tab (a
    // real downstream consumer the weigh-in moved), NOT a bare /lots 404.
    expect(hrefs).toContain("/harvests");
    expect(hrefs).not.toContain("/lots"); // never point a link at a non-route

    // a generic "Tu lote" + the "confirms on sync" reassurance (facet-01 §4 offline AC).
    expect(screen.getByText(/Tu lote/i)).toBeInTheDocument();
    expect(screen.getByText(/sincroniza/i)).toBeInTheDocument();
  });

  it("renders nothing actionable when there is no delta yet (idle, before first capture)", () => {
    const { container } = render(<RippleProof lotCode={null} lastDeltaKg={null} />);
    // No proof to show before a capture: the panel renders empty (no dead UI / no links).
    expect(container.querySelectorAll("a").length).toBe(0);
  });
});
