import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { replace, refresh, signInWithPassword } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));

import { LoginForm } from "@/components/auth/login-form";

describe("LoginForm", () => {
  it("renders email + password fields and a submit button", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it("surfaces an error and does not navigate on bad credentials", async () => {
    signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login credentials" },
    });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "x@y.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("navigates to the dashboard on successful sign-in", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: null });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
