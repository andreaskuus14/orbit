"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ERRORS: Record<string, string> = {
  not_allowed: "That email isn't on this ORBIT's allowlist.",
  auth_failed: "That sign-in link didn't work or has expired. Request a new one.",
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("error");
    if (code) setErr(ERRORS[code] ?? "Sign-in failed.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setErr("");
    const { error } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    if (error) { setErr(error.message); setState("idle"); } else setState("sent");
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/orbit-mark.png" alt="" width={96} height={96} className="rounded-2xl shadow-[0_0_40px_rgba(34,211,238,0.35)]" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <div className="brand text-2xl">ORBIT</div><p className="muted text-sm">Your mind has a universe.</p>
        </div>
        {state === "sent" ? (
          <p className="ok text-center">Check your inbox for a sign-in link.</p>
        ) : (
          <>
            <input className="field w-full" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <button className="btn w-full" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
          </>
        )}
        {err && <p className="error text-center" role="alert">{err}</p>}
      </form>
    </main>
  );
}
