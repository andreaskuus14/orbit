"use client";
// Gate for the "What's new" tour (WhatsNewBody.tsx + tour-pure's step data): loads the body only when the tour auto-opens
// (nothing stored for TOUR_KEY yet, same rule as tour-pure parseProgress/shouldAutoOpen) or is reopened from Ctrl+K.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TOUR_EVENT, TOUR_KEY } from "@/lib/tour-key-pure";

const WhatsNewBody = dynamic(() => import("./WhatsNewBody"), { ssr: false });
const unseen = () => { try { const j = JSON.parse(localStorage.getItem(TOUR_KEY) || "null"); return !j || typeof j !== "object"; } catch { return true; } };

export function WhatsNew({ home }: { home: boolean }) {
  const [on, setOn] = useState<null | "auto" | "reopen">(null); // once mounted the body stays, with its own TOUR_EVENT listener
  useEffect(() => {
    if (unseen()) setOn("auto");
    const reopen = () => setOn((o) => o ?? "reopen");
    addEventListener(TOUR_EVENT, reopen);
    return () => removeEventListener(TOUR_EVENT, reopen);
  }, []);
  return on && <WhatsNewBody home={home} reopen={on === "reopen"} />;
}
