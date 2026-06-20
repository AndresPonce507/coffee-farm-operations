/**
 * Pure auth-routing decision, shared by the middleware. Kept side-effect-free so
 * the gate logic is unit-testable without constructing NextRequest/NextResponse.
 *
 * Single-owner app: everything except /login requires a session; a signed-in user
 * hitting /login is bounced to the dashboard.
 */
export type RedirectDecision = { redirectTo: string } | null;

export const LOGIN_PATH = "/login";

export function authRedirect(hasUser: boolean, pathname: string): RedirectDecision {
  const isLogin = pathname === LOGIN_PATH;
  if (!hasUser && !isLogin) return { redirectTo: LOGIN_PATH };
  if (hasUser && isLogin) return { redirectTo: "/" };
  return null;
}
