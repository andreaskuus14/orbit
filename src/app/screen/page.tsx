import type { Metadata } from "next";
import { ScreenApp } from "@/components/ScreenApp";

export const metadata: Metadata = { title: "ORBIT Screen", appleWebApp: { capable: true, title: "ORBIT Screen", statusBarStyle: "black-translucent" } };

export default function ScreenPage() {
  return <ScreenApp />;
}
