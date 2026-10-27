"use client";
import { useState } from "react";
import { useT } from "./i18n";
import { createClient } from "@/lib/supabase/client";
import { PASSWORD_MIN, passwordProblem } from "@/lib/password-pure";

/** Profile: set or change the sign-in password, so a new browser needs no email link. */
export function PasswordSection() {
  const { t } = useT();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw, confirm);
    if (problem) return setMsg({ ok: false, text: problem });
    setBusy(true); setMsg(null);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPw(""); setConfirm("");
    setMsg({ ok: true, text: "Password saved. On a new browser, choose “Sign in with password” on the login page." });
  }
  return (
    <form onSubmit={save} className="space-y-3" aria-labelledby="pw-title">
      <h3 id="pw-title" className="text-sm font-semibold">{t("profile.password")}</h3>
      <p className="muted text-sm">Optional. With a password you can sign in on a new browser without waiting for an email link.</p>
      <label className="block text-sm">New password<input className="field mt-1 w-full" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={72} required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <label className="block text-sm">Repeat it<input className="field mt-1 w-full" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      {msg && <p className={msg.ok ? "ok text-sm" : "error text-sm"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </form>
  );
}
