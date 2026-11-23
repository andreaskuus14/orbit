"use client";
// While mounted (and `on`), tells the server a LIFE screen is open so desk screenshots are refused (lib/life-shield.ts).
import { useEffect } from "react";
import { SHIELD_PING_MS } from "@/lib/life-private-pure";

const send = (who: string, on: boolean) =>
  fetch("/api/life", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "shield", who, on }) }).catch(() => {});

export function useLifeShield(who: "panel" | "evening", on = true) {
  useEffect(() => {
    if (!on) return;
    void send(who, true);
    const t = setInterval(() => void send(who, true), SHIELD_PING_MS);
    return () => { clearInterval(t); void send(who, false); };
  }, [who, on]);
}
