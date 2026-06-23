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

    // Accept a bare username (e.g. "ponce507") or a full email address.
    const loginEmail = email.includes("@")
      ? email.trim()
      : `${email.trim()}@jansoncoffee.com`;
    const { error: signInError } = await createClient().auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (signInError) {
      setError("Ese correo o contraseña no coincide. Inténtalo de nuevo.");
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
          Usuario o correo
        </label>
        <input
          id="email"
          type="text"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ponce507"
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-xs font-medium text-muted-fg">
          Contraseña
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
        {pending && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
        {pending ? "Iniciando sesión…" : "Iniciar sesión"}
      </Button>
    </form>
  );
}
