import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { readStream } from "@/lib/vault";
import { scanJobs, startScan } from "@/lib/photo-scan";
import { MAX_PHOTOS } from "@/lib/photo-scan-pure";

export const dynamic = "force-dynamic";

// ARCH photo scan: POST multipart {title, photos: File[] (from this browser or the phone), vault: VAULT picture names} → {job};
// GET → {jobs} for the "Working on it" card. Runs on this PC only (Local AI on loopback); nothing is uploaded anywhere.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ jobs: scanJobs() });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/arch/photo-scan", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const form = await req.formData().catch(() => null);
  if (!form) return fail("Send the photos as a form.");
  const photos = form.getAll("photos").filter((f): f is File => f instanceof File);
  const names = form.getAll("vault").map(String).filter(Boolean).slice(0, MAX_PHOTOS + 1);
  try {
    for (const n of names) { // VAULT pictures: traversal and missing names are refused in readStream
      const { stream } = await readStream(n, null);
      if (!stream) throw new Error(`Couldn't read ${n} from VAULT.`);
      photos.push(new File([await new Response(stream).blob()], n));
    }
    const job = startScan({ sb, userId: user.id, title: String(form.get("title") ?? ""), photos });
    return Response.json({ job });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
