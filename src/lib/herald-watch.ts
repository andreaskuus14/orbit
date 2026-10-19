import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { getTrends, nicheViral } from "./devtools";
import { trendCards, viralCards, type HeraldCard } from "./herald-pure";
import { mergeInbox, parseInbox, toastPicks } from "./herald-watch-pure";
import { stopAllOn } from "./stop-all";

// Herald watch: every 3 h (first ~2 min after start) the server scans the niche (nicheViral, ≤301 YouTube units, scout budget)
// and trends, and appends new cards to <data dir>/herald-inbox.json for Herald.tsx (GET /api/herald). New clippable cards also get
// a Windows toast that opens ORBIT. Never starts a clip job: the owner presses "Clip it now" in ORBIT.

const file = () => path.join(orbitDataDir(), "herald-inbox.json");
type St = { timer?: NodeJS.Timeout; tickFn?: unknown; running?: boolean };
const g = globalThis as unknown as { __orbitHeraldWatch?: St }; // survives dev hot reloads: one timer
const S = (g.__orbitHeraldWatch ??= {});
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function readInbox(now = Date.now()) {
  return parseInbox(JSON.parse(await readFile(file(), "utf8").catch(() => "[]")), now);
}

// Titles come from YouTube (untrusted): they reach the script only as env vars and are XML-escaped inside PowerShell.
const TOAST_PS = `$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$t = [System.Security.SecurityElement]::Escape($env:ORBIT_TOAST_TITLE)
$b = [System.Security.SecurityElement]::Escape($env:ORBIT_TOAST_BODY)
$u = [System.Security.SecurityElement]::Escape($env:ORBIT_TOAST_URL)
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast activationType=""protocol"" launch=""$u""><visual><binding template=""ToastGeneric""><text>$t</text><text>$b</text></binding></visual></toast>")
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
const TOAST_B64 = Buffer.from(TOAST_PS, "utf16le").toString("base64");

function toast(c: HeraldCard): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  const env = { ...process.env, ORBIT_TOAST_TITLE: c.title.slice(0, 120), ORBIT_TOAST_BODY: (c.body ?? "").slice(0, 200), ORBIT_TOAST_URL: `http://127.0.0.1:${process.env.PORT || 3000}/` };
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", TOAST_B64],
      { env, windowsHide: true, timeout: 20_000, killSignal: "SIGKILL" }, (e) => { if (e) console.error("[herald-watch] toast:", msg(e)); resolve(); });
  });
}

async function tick() {
  if (S.running || stopAllOn()) return;
  S.running = true;
  try {
    const now = Date.now();
    const [v, t] = await Promise.all([nicheViral(now), getTrends(now)]);
    const cards = [...viralCards(v), ...trendCards(t)];
    if (!cards.length) return;
    const old = JSON.parse(await readFile(file(), "utf8").catch(() => "[]")); // shortcut: a corrupt inbox restarts empty (it's only a cache)
    const { inbox, added } = mergeInbox(old, cards, now);
    if (!added.length) return;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(inbox));
    await rename(file() + ".tmp", file());
    for (const c of toastPicks(added, Date.now())) if (!stopAllOn()) await toast(c);
  } catch (e) {
    console.error("[herald-watch]", msg(e));
  } finally { S.running = false; }
}

export function startHeraldWatch() {
  if (S.timer && S.tickFn === tick) return;
  if (S.timer) clearInterval(S.timer); // code was updated: swap in the new tick
  S.tickFn = tick;
  S.timer = setInterval(() => void tick(), 3 * 3_600_000);
  setTimeout(() => void tick(), 2 * 60_000);
}
