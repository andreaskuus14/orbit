"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SiteEditor } from "@/components/SiteEditor";
import type { Brief } from "@/lib/site-brief-pure";

// /sites/edit?ws=<workspace>: the Puck section editor for a site built from a brief (trial).
function Load() {
  const ws = useSearchParams().get("ws") ?? "";
  const [s, set] = useState<{ brief: Brief; base: string } | { error: string } | null>(null);
  useEffect(() => { fetch(`/api/sites/edit?ws=${encodeURIComponent(ws)}`).then((r) => r.json()).then(set, () => set({ error: "Could not load the site" })); }, [ws]);
  if (!s) return <p className="p-4">Loading…</p>;
  if ("error" in s || !("brief" in s)) return <p className="p-4" role="alert">{"error" in s ? s.error : "Could not load the site"}</p>;
  return <SiteEditor ws={ws} brief={s.brief} base={s.base} />;
}

export default function Page() {
  return <Suspense><Load /></Suspense>;
}
