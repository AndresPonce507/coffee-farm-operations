import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only anon Supabase client for Server Components.
 *
 * The app only reads public farm data, so the anon key + RLS (SELECT-only)
 * is all we need — no auth, no cookies, no service-role key in the bundle.
 * Cached at module scope: one client per server runtime, reused across requests.
 */
let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
    );
  }

  cached = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
