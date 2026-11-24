"use client";
// /chat: the CORE chat as its own small app for the phone home screen (and any narrow window). Same CorePanel, same sign-in.
// Registers /chat/sw.js (scope /chat) so it installs and opens instantly; Android's install prompt is offered once, as a plain button.
import { useCallback, useEffect, useState } from "react";
import { CorePanel } from "./CoreChat";
import { useT } from "./i18n";
import { takeAsk } from "@/lib/phone-pwa-pure";

type InstallEvent = Event & { prompt: () => Promise<void> };

export function ChatApp() {
  const { t } = useT();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [offline, setOffline] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => {
    // /m's ask box hands its question over in this tab's sessionStorage (same origin only, so a link from another site can't
    // make CORE send anything); it is taken once and removed, so a reload doesn't send it again.
    const q = takeAsk(sessionStorage);
    if (q) setAsk(q);
    if (location.search) history.replaceState(null, "", "/chat");
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/chat/sw.js", { scope: "/chat" }).catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    const net = () => setOffline(!navigator.onLine);
    net();
    addEventListener("beforeinstallprompt", onPrompt);
    addEventListener("online", net); addEventListener("offline", net);
    return () => { removeEventListener("beforeinstallprompt", onPrompt); removeEventListener("online", net); removeEventListener("offline", net); };
  }, []);
  // A memory or source link opens in full ORBIT (MEMORY lives there).
  const openMemory = useCallback((id: string) => { location.href = `/#o=memory&k=memory&id=${encodeURIComponent(id)}`; }, []);
  return (
    <main className="chat-app orbit-shell">
      <header className="mb-2 flex items-center gap-2 text-xs">
        <b className="brand text-sm tracking-widest">ORBIT</b>
        {offline && <span className="text-amber-300" role="status">{t("chat.offline")}</span>}
        <span className="flex-1" />
        {install && <button type="button" className="chip" onClick={() => { void install.prompt(); setInstall(null); }}>{t("chat.install")}</button>}
        <a className="chip" href="/">{t("chat.full")}</a>
      </header>
      <CorePanel initial={ask} onConsumed={() => setAsk(null)} onOpenMemory={openMemory} />
    </main>
  );
}
