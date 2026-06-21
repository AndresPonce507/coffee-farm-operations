import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { replace, refresh, signOut, purgeOfflineCaches } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn().mockResolvedValue({ error: null }),
  purgeOfflineCaches: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut } }),
}));
vi.mock("@/lib/offline/purge", () => ({ purgeOfflineCaches }));

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

  it("purges Service Worker caches on sign-out (no stale PII on shared devices)", async () => {
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(purgeOfflineCaches).toHaveBeenCalled());
    // purge must happen before the redirect so the cache is gone by /login.
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
