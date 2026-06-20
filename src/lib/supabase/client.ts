import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — used by the login form (a Client Component) to call
 * signInWithPassword / signOut. Reads the public anon key from the bundle.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
