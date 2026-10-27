"use client";
// Gate for the morning brief (MorningBriefBody.tsx): decides, once a minute and on tab focus, whether today's brief is due, and
// only then loads and mounts the body. ORBIT is often left open overnight, so a new day remounts it (fresh fetch).
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { localDay } from "@/lib/morning-pure";
import { shouldShowBrief } from "@/lib/brief-pure";

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
      if (!shouldShowBrief(last, now.getHours(), today)) return;
      try { localStorage.setItem(KEY, today); } catch { /* ignore */ }
      setDay(today);
    };
    check();
    const t = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, []);

  return day && <MorningBriefBody key={day} home={home} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal} onClose={() => setDay(null)} />;
}
