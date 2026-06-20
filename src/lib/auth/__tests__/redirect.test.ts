import { describe, expect, it } from "vitest";
import { authRedirect } from "@/lib/auth/redirect";

describe("authRedirect (single-owner gate)", () => {
  it("sends an unauthenticated visitor on a protected route to /login", () => {
    expect(authRedirect(false, "/")).toEqual({ redirectTo: "/login" });
    expect(authRedirect(false, "/plots")).toEqual({ redirectTo: "/login" });
    expect(authRedirect(false, "/workers")).toEqual({ redirectTo: "/login" });
  });

  it("lets an unauthenticated visitor reach /login (no redirect loop)", () => {
    expect(authRedirect(false, "/login")).toBeNull();
  });

  it("bounces a signed-in user away from /login to the dashboard", () => {
    expect(authRedirect(true, "/login")).toEqual({ redirectTo: "/" });
  });

  it("lets a signed-in user reach protected routes", () => {
    expect(authRedirect(true, "/")).toBeNull();
    expect(authRedirect(true, "/processing")).toBeNull();
  });
});
