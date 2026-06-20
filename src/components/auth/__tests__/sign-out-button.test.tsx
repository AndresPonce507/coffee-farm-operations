import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { replace, refresh, signOut } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut } }),
}));

import { SignOutButton } from "@/components/auth/sign-out-button";

describe("SignOutButton", () => {
  it("renders an accessible sign-out control", () => {
    render(<SignOutButton />);
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("signs out and redirects to /login", async () => {
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
