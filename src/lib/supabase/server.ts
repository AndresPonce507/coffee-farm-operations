import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
    );
  }
  return { url, anonKey };
}

/**
 * Per-request, cookie-aware Supabase client for Server Components.
 *
 * Carries the signed-in user's session (via cookies) so reads run as the
 * `authenticated` role and satisfy RLS. cache()'d so one render reuses a single
 * client instance.
 */
export const getSupabase = cache(async () => {
  const { url, anonKey } = env();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll is called from a Server Component, where cookies are
          // read-only. The middleware refreshes the session cookie instead,
          // so this is safe to ignore.
        }
      },
    },
  });
});
