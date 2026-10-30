"use client";
// Gate for the "What's new" tour (WhatsNewBody.tsx + tour-pure's step data): the body shows only steps newer than the owner last saw
// (startup-pure newSince, after the morning card) or the full tour when reopened from Ctrl+K.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TOUR_EVENT } from "@/lib/tour-key-pure";

const WhatsNewBody = dynamic(() => import("./WhatsNewBody"), { ssr: false });

export function WhatsNew({ home }: { home: boolean }) {
  const [on, setOn] = useState<null | "auto" | "reopen">(null); // once mounted the body stays, with its own TOUR_EVENT listener
  useEffect(() => {
    setOn("auto"); // the body compares known step ids (startup-pure newSince) and shows only what is new, or nothing
    const reopen = () => setOn((o) => o ?? "reopen");
    addEventListener(TOUR_EVENT, reopen);
    return () => removeEventListener(TOUR_EVENT, reopen);
  }, []);
  return on && <WhatsNewBody home={home} reopen={on === "reopen"} />;
}
