import { requireUser } from "@/lib/supabase/server";
import { readInbox } from "@/lib/herald-watch";

/** Herald inbox: niche/trend cards the server found in the background (src/lib/herald-watch.ts), newer than 3 days. */
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try {
    return Response.json({ cards: await readInbox() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Inbox unreadable" }, { status: 500 });
  }
}
