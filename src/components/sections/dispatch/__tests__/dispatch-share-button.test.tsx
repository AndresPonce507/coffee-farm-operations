import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DispatchCard } from "@/lib/types";

import { DispatchShareButton } from "@/components/sections/dispatch/dispatch-share-button";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const card: DispatchCard = {
  id: 7,
  crewId: "crew-norte",
  crewName: "Crew Norte",
  dispatchDate: "2026-06-22",
  season: "2026",
  status: "draft",
  sentChannel: null,
  readinessThreshold: 0.5,
  idempotencyKey: "disp-1",
  plotCount: 1,
  plots: [
    {
      id: 1,
      dispatchRunId: 7,
      plotId: "p-norte-1",
      plotName: "Norte Bajo",
      variety: "Catuaí",
      altitudeMasl: 1400,
      taskKind: "picking",
      targetKg: null,
      ripenessTarget: "high",
      readiness: 0.95,
      ord: 1,
    },
  ],
};

describe("DispatchShareButton ($0 web-share, owner-initiated outbound)", () => {
  it("renders a share affordance for a draft dispatch", () => {
    render(<DispatchShareButton card={card} />);
    expect(
      screen.getByRole("button", { name: /share|compartir/i }),
    ).toBeInTheDocument();
  });

  it("shares via the web-share adapter then marks the dispatch sent (the action)", async () => {
    const deliver = vi.fn().mockResolvedValue({
      ok: true,
      channel: "web-share",
      via: "clipboard",
    });
    const markSent = vi.fn().mockResolvedValue({ status: "success" });

    render(
      <DispatchShareButton card={card} deliver={deliver} markSentAction={markSent} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /share|compartir/i }));

    await waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    // the deliver call carries the run id + the rendered card text.
    const arg = deliver.mock.calls[0][0];
    expect(arg.runId).toBe(7);
    expect(typeof arg.text).toBe("string");
    expect(arg.text).toMatch(/Norte Bajo/);

    // after a successful share, the owner-initiated mark-sent action fires with the run id.
    await waitFor(() => expect(markSent).toHaveBeenCalledTimes(1));
    const fd = markSent.mock.calls[0][0] as FormData;
    expect(fd.get("runId")).toBe("7");
    expect(fd.get("channel")).toBe("web-share");
  });

  it("does NOT mark sent when the share itself fails (no false 'sent')", async () => {
    const deliver = vi.fn().mockResolvedValue({
      ok: false,
      reason: "no share or clipboard available",
    });
    const markSent = vi.fn().mockResolvedValue({ status: "success" });

    render(
      <DispatchShareButton card={card} deliver={deliver} markSentAction={markSent} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /share|compartir/i }));

    await waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    // share failed → the dispatch is NOT marked sent (the manager retries).
    expect(markSent).not.toHaveBeenCalled();
  });

  it("stays un-sent (no UI lie) when the mark-sent action THROWS after a good share", async () => {
    const deliver = vi.fn().mockResolvedValue({
      ok: true,
      channel: "web-share",
      via: "clipboard",
    });
    // the share succeeded but recording the send blew up (route/network error).
    const markSent = vi.fn().mockRejectedValue(new Error("network down"));

    render(
      <DispatchShareButton card={card} deliver={deliver} markSentAction={markSent} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /share|compartir/i }));

    await waitFor(() => expect(markSent).toHaveBeenCalledTimes(1));
    // a retryable error is surfaced…
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /couldn’t mark as sent/i,
      ),
    );
    // …and the button is STILL the live, tappable share affordance — never "Shared".
    const button = screen.getByRole("button", { name: /share|compartir/i });
    expect(button).not.toBeDisabled();
    expect(screen.queryByText(/^shared$/i)).not.toBeInTheDocument();
  });

  it("stays un-sent when the mark-sent action RETURNS an error state (no throw)", async () => {
    const deliver = vi.fn().mockResolvedValue({
      ok: true,
      channel: "web-share",
      via: "clipboard",
    });
    // the action returned cleanly but signalled failure via its DispatchActionState.
    const markSent = vi.fn().mockResolvedValue({ status: "error", message: "boom" });

    render(
      <DispatchShareButton card={card} deliver={deliver} markSentAction={markSent} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /share|compartir/i }));

    await waitFor(() => expect(markSent).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /couldn’t mark as sent/i,
      ),
    );
    expect(screen.queryByText(/^shared$/i)).not.toBeInTheDocument();
  });

  it("announces success through an always-mounted aria-live region", async () => {
    const deliver = vi.fn().mockResolvedValue({
      ok: true,
      channel: "web-share",
      via: "clipboard",
    });
    const markSent = vi.fn().mockResolvedValue({ status: "success" });

    const { container } = render(
      <DispatchShareButton card={card} deliver={deliver} markSentAction={markSent} />,
    );

    // the live region exists BEFORE any interaction (so AT can announce changes to it).
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: /share|compartir/i }));

    // the SAME node (never re-mounted) carries the success message.
    await waitFor(() =>
      expect(liveRegion).toHaveTextContent(/dispatch shared/i),
    );
    // the visual state flips to the disabled "Shared" confirmation button.
    expect(
      screen.getByRole("button", { name: /shared/i }),
    ).toBeDisabled();
  });
});
