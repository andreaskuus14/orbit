"use client";
// Gate for the morning brief (MorningBriefBody.tsx): decides, once a minute and on tab focus, whether today's brief is due; then it
// waits in the header pill (startup-store) and loads and mounts the body as a side sheet only when he opens it. ORBIT is often left open overnight, so a new day remounts it (fresh fetch).
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { localDay } from "@/lib/morning-pure";
import { shouldShowBrief } from "@/lib/brief-pure";
import { setReady, useOpenRequest } from "./startup-store";

const KEY = "orbit.brief"; // the local day it was last shown
const MorningBriefBody = dynamic(() => import("./MorningBriefBody"), { ssr: false });

export function MorningBrief({ home, onOpenTask, onOpenGoal }: { home: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
  const [day, setDay] = useState<string | null>(null); // the day being shown; null = closed
  const homeRef = useRef(home);
  homeRef.current = home;

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible" || !homeRef.current) return;
      const now = new Date(), today = localDay(now);
      let last: string | null = null;
      try { last = localStorage.getItem(KEY); } catch { /* no storage: shows once per load */ }
      setReady("brief", shouldShowBrief(last, now.getHours(), today)); // quiet open: waits in the header pill until he opens it
    };
    check();
    const t = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, []);

  useOpenRequest("brief", () => {
    const today = localDay(new Date());
    try { localStorage.setItem(KEY, today); } catch { /* ignore */ }
    setReady("brief", false); setDay(today);
  });
  return day && <MorningBriefBody key={day} home={home} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal} onClose={() => setDay(null)} />;
}
