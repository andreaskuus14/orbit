"use client";
// Deep research runs on the shared "Working on it" card inside the CORE chat (the same cards home shows, api/research).
// Polls every 5 s while one is running, every 30 s otherwise; shows only running ones and ones finished in the last 10 minutes.
import { useCallback, useState } from "react";
import type { Progress } from "@/lib/progress-pure";
import { usePoll, sharedJson } from "./use-poll";
import { ProgressList } from "./ProgressCard";

export function ResearchCards() {
  const [cards, setCards] = useState<Progress[]>([]);
  const load = useCallback(() => {
    void sharedJson<{ cards?: Progress[] }>("/api/research").then((j) => {
      const now = Date.now();
      setCards((Array.isArray(j?.cards) ? j.cards : []).filter((c) => c.phase === "working" || c.phase === "waiting" || now - Date.parse(c.at) < 10 * 60_000));
    });
  }, []);
  usePoll(load, cards.some((c) => c.phase === "working") ? 5_000 : 30_000);
  return cards.length ? <div className="mb-3"><ProgressList items={cards} compact /></div> : null;
}
