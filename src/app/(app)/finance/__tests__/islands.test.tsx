import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The three interactive islands are client components. Mock next/navigation's
// useRouter (no App Router in jsdom) and stub the server-action module so importing
// the island never pulls in the Supabase/revalidate stack. These are render/smoke
// tests: the island mounts and exposes its (confirm-gated) entry points — no
// money-shaped write fires on mount.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/finance/actions", () => ({
  issueArDocAction: vi.fn(),
  settleArPaymentAction: vi.fn(),
  voidArDocAction: vi.fn(),
  setAccountMapAction: vi.fn(),
  retrySyncAction: vi.fn(),
}));

import { NewInvoice } from "@/app/(app)/finance/invoices/new-invoice.client";
import { PaymentActions } from "@/app/(app)/finance/invoices/[number]/payment-actions.client";
import { SyncConsole } from "@/app/(app)/finance/sync/sync-console.client";

afterEach(cleanup);

describe("finance client islands (smoke)", () => {
  it("NewInvoice mounts and exposes the issue trigger", () => {
    render(<NewInvoice />);
    expect(
      screen.getByRole("button", { name: /New invoice/ }),
    ).toBeInTheDocument();
  });

  it("PaymentActions exposes a confirm-gated 'Record payment' trigger (never auto)", () => {
    render(
      <PaymentActions
        arDocId={1}
        docNumber="JC-CI-0001"
        currency="USD"
        balanceUsd={10000}
        canPay
        canVoid
      />,
    );
    expect(
      screen.getByRole("button", { name: /Record payment/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Void/ })).toBeInTheDocument();
  });

  it("PaymentActions renders nothing when neither pay nor void is allowed", () => {
    const { container } = render(
      <PaymentActions
        arDocId={1}
        docNumber="JC-CI-0001"
        currency="USD"
        balanceUsd={0}
        canPay={false}
        canVoid={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("SyncConsole mounts the queue-drain controls and the mapping editor entry", () => {
    render(<SyncConsole />);
    expect(screen.getByRole("button", { name: /Add mapping/ })).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Process queue/ }).length,
    ).toBeGreaterThanOrEqual(3);
  });
});
