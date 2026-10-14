import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Orbit from "@/components/Orbit";

export const dynamic = "force-dynamic";

export default async function Home() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  return <Orbit userId={user.id} email={user.email ?? ""} />;
}
