import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { authRedirect } from "@/lib/auth/redirect";

/**
 * Refreshes the Supabase session cookie on every request and enforces the
 * single-owner gate: unauthenticated visitors are sent to /login, signed-in
 * users are kept off /login. Returns the (possibly redirected) response.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // If env is missing, don't hard-fail the edge — let the app surface its error.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the JWT with the Auth server — do not trust getSession alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const decision = authRedirect(Boolean(user), request.nextUrl.pathname);
  if (decision) {
    const target = request.nextUrl.clone();
    target.pathname = decision.redirectTo;
    return NextResponse.redirect(target);
  }

  return response;
}
