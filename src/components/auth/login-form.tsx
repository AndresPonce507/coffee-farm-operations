"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const FIELD =
  "h-11 w-full rounded-xl border border-line bg-white/70 px-3.5 text-sm text-ink placeholder:text-muted-fg/70 outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const { error: signInError } = await createClient().auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError("That email or password doesn't match. Please try again.");
      setPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-xs font-medium text-muted-fg">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-xs font-medium text-muted-fg">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className={FIELD}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
