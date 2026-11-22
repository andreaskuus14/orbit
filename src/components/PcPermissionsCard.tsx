"use client";
// Profile → Autonomy → PC Control Permissions: explicit On/Off toggles for Terminal, Terminal auto-run,
// PC apps & files, Screen & window watch, and Chrome browser control.
import { useCallback, useEffect, useState } from "react";
import { PC_PERM_KEYS, type PcPermKey, type PcPermissions } from "@/lib/pc-permissions-pure";
import type { Key } from "@/lib/i18n-pure";
import { useT } from "./i18n";

export function PcPermissionsCard() {
  const { t } = useT();
  const [perms, setPerms] = useState<PcPermissions | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/pc-permissions", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { perms?: PcPermissions };
      if (j.perms) setPerms(j.perms);
    } catch { /* quiet */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/pc-permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as { perms?: PcPermissions; error?: string };
      if (!r.ok || !j.perms) { setErr(j.error || "Failed"); return; }
      setPerms(j.perms);
    } finally { setBusy(false); }
  };

  if (!perms) return null;

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold">{t("pcperm.title")}</h4>
          <p className="muted text-xs">{t("pcperm.sub")}</p>
        </div>
        <button type="button" className="chip text-xs" disabled={busy} onClick={() => void send({ action: "disable_all" })}>
          {t("pcperm.allOff")}
        </button>
      </div>
      <ul className="space-y-1.5">
        {PC_PERM_KEYS.map((k: PcPermKey) => {
          const on = perms[k];
          const disabled = busy || (k === "terminalAuto" && !perms.terminal);
          return (
            <li key={k} className="flex items-center justify-between gap-2 border-b border-white/5 pb-1.5 text-xs last:border-b-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t(`pcperm.${k}.label` as Key)}</div>
                <div className="muted text-[11px]">{t(`pcperm.${k}.desc` as Key)}</div>
              </div>
              <button
                type="button"
                className="chip shrink-0 text-xs"
                aria-pressed={on}
                disabled={disabled}
                style={on ? { borderColor: "var(--cyan)" } : undefined}
                onClick={() => void send({ [k]: !on })}
              >
                {t(on ? "common.on" : "common.off")}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted text-[11px]">{t("pcperm.locks")}</p>
      {err && <p className="error text-xs" role="alert">{err}</p>}
    </div>
  );
}
