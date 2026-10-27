import { deviceFromCookie, rateOk, remoteProblem, updateDevices } from "@/lib/remote";
import { RATE } from "@/lib/remote-web-pure";
import { parseSubscription } from "@/lib/remote-push-pure";
import { parseLang } from "@/lib/i18n-pure";
import { deliver, pushProblem } from "@/lib/remote-push";

export const dynamic = "force-dynamic";

// Phone push (6.3), paired device only. GET: {problem, publicKey, on}. POST <PushSubscription.toJSON()>: store it on this device and
// send a confirmation push. DELETE: forget it. Revoking the device on the PC deletes the subscription with it.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function paired() {
  const problem = remoteProblem();
  if (problem) return { res: fail(problem, 503) };
  const device = await deviceFromCookie();
  if (!device) return { res: fail("Not paired", 401) };
  if (!rateOk(`push:${device.id}`, RATE.cmd)) return { res: fail("Too many requests: wait a minute", 429) };
  return { device };
}

export async function GET() {
  const { device, res } = await paired();
  if (!device) return res;
  const problem = pushProblem();
  return Response.json({ problem, publicKey: problem ? null : process.env.REMOTE_VAPID_PUBLIC, on: !!device.push });
}

export async function POST(req: Request) {
  const { device, res } = await paired();
  if (!device) return res;
  const problem = pushProblem();
  if (problem) return fail(problem, 503);
  const raw = await req.text().catch(() => "");
  if (raw.length > 4096) return fail("Request too large", 413);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* below */ }
  const p = parseSubscription(body);
  if (!p.ok) return fail(p.error);
  const lang = parseLang((body as { lang?: unknown }).lang); // shortcut: set at subscribe time only; switching language later needs a re-enable
  await updateDevices((ds) => ds.map((d) => (d.id === device.id ? { ...d, push: p.sub, lang } : d)));
  const sent = await deliver({ title: "Notifications are on", body: "ORBIT will tell you when something needs you.", url: "/remote", tag: "stop" }, device.id);
  return Response.json({ ok: true, sent: sent > 0 });
}

export async function DELETE() {
  const { device, res } = await paired();
  if (!device) return res;
  await updateDevices((ds) => ds.map((d) => (d.id === device.id ? { ...d, push: undefined } : d)));
  return Response.json({ ok: true });
}
