// The phone app's install manifest (/m). Browsers fetch it without cookies, so it is public; it holds no data.
import { phoneManifest } from "@/lib/phone-pwa-pure";

export const dynamic = "force-static";

export function GET() {
  return Response.json(phoneManifest(), { headers: { "Content-Type": "application/manifest+json" } });
}
