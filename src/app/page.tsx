import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { missingSettings } from "@/lib/release-check-pure";
import Orbit from "@/components/Orbit";

export const dynamic = "force-dynamic";

export default async function Home() {
  const missing = missingSettings({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (missing.length > 0) {
    return <Orbit userId="local-owner" email="local@orbit" />;
  }
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  return <Orbit userId={user.id} email={user.email ?? ""} />;
}
