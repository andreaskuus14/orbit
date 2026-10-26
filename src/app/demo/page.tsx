// Public demo galaxy: fixture data only, computed at build time (static). No session, no Supabase, no model calls.
import type { Metadata } from "next";
import DemoOrbit from "@/components/DemoOrbit";
import { demoData } from "./data";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Orbital — demo", description: "A read-only tour of ORBIT with invented sample data.", robots: { index: false } };

export default function DemoPage() {
  const data = demoData();
  const map = data["GET /api/memories/map"] as { items: unknown[] };
  return <DemoOrbit data={data} memoryCount={map.items.length} />;
}
