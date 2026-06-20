import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Topbar is now an async Server Component that reads the session + renders the
// client SignOutButton + MobileNav (both use next/navigation). Mock both.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/plots",
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { email: "owner@example.com" } },
      })),
    },
  })),
}));

import { Topbar } from "@/components/layout/topbar";

describe("Topbar", () => {
  it("gives the search input an accessible name", async () => {
    render(await Topbar());
    const search = screen.getByRole("searchbox", { name: /search/i });
    expect(search).toBeInTheDocument();
    expect(screen.getByLabelText(/search/i)).toBe(search);
  });

  it("shows the signed-in email and a sign-out control", async () => {
    render(await Topbar());
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });
});
