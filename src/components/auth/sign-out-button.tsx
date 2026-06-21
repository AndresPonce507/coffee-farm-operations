"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { purgeOfflineCaches } from "@/lib/offline/purge";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await createClient().auth.signOut();
    // Clear any Service Worker-cached authenticated pages (payroll/PII/EUDR) so
    // they can't be served to the next person on a shared field device.
    await purgeOfflineCaches();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
      className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-card text-muted-fg transition hover:text-ink disabled:opacity-50"
    >
      <LogOut className="h-[18px] w-[18px]" />
    </button>
  );
}
