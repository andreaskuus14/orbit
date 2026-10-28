// Roblox development continuity (roadmap 39), pure: one backlog item followed from observation → proposed fix → review →
// test evidence → the version Andreas shipped. ORBIT never edits the place: a fix is only ever "proposed" or "reviewed";
// only Andreas records the version he applied in Studio himself. Tested in tests/dev-trail.test.ts.
import type { Bug } from "./devworld-pure.ts";
import type { DevSession } from "./dev-session-pure.ts";
import type { Lang } from "./i18n-pure.ts";

export type FixState = "proposed" | "reviewed" | "rejected"; // deliberately no "applied"
export type Trail = { bugId: string; sessionIds: string[]; fix?: { text: string; state: FixState; at: string }; version?: { name: string; at: string; by: "owner" } };
export type StepKind = "observed" | "session" | "fix" | "evidence" | "version";
export type Step = { kind: StepKind; at: string; text: string; ok?: boolean };

const T = {
  en: { observed: "Observed", session: "Studio session", fix: "Fix", evidence: "Test evidence", version: "Version",
    proposed: "proposed, not applied", reviewed: "reviewed by you, not applied by ORBIT", rejected: "rejected",
    shipped: "you shipped it in", missing: "Next" , needFix: "propose a fix", needReview: "review the proposed fix", needTest: "playtest it in Studio", needVersion: "record the version you shipped" },
  et: { observed: "Märgatud", session: "Studio sessioon", fix: "Parandus", evidence: "Testi tõend", version: "Versioon",
    proposed: "ettepanek, pole rakendatud", reviewed: "sinu üle vaadatud, ORBIT ei rakendanud", rejected: "tagasi lükatud",
    shipped: "avaldasid selle versioonis", missing: "Järgmine", needFix: "paku parandus", needReview: "vaata parandus üle", needTest: "mängi see Studios läbi", needVersion: "märgi avaldatud versioon" },
} as const;

const words = (s: string) => new Set(s.toLowerCase().match(/[a-zõäöü0-9]{4,}/g) ?? []);
/** Sessions that look related: an event label or error contains a title word's first 5 letters ("hatches" → HatchService), from its creation on. */
export function suggestSessions(bug: Pick<Bug, "title" | "created">, sessions: DevSession[]): string[] {
  const w = words(bug.title);
  return sessions.filter((s) => (s.last >= bug.created) && s.events.some((e) => { const t = `${e.label} ${e.errors.join(" ")}`.toLowerCase(); return [...w].some((x) => t.includes(x.slice(0, 5))); })).map((s) => s.id);
}

/** Recording a version is the owner's act; ORBIT can only propose or mark reviewed. Version before a reviewed fix is refused. */
export function setVersion(t: Trail, name: string, at: string): Trail | null {
  const n = name.trim().slice(0, 40);
  return n && t.fix?.state === "reviewed" ? { ...t, version: { name: n, at, by: "owner" } } : null;
}

/** The trail, oldest first, plus what is still missing. Evidence = playtest events in linked sessions after the fix was proposed. */
export function trailSteps(bug: Bug, t: Trail, sessions: DevSession[], lang: Lang = "en"): { steps: Step[]; next: string | null } {
  const x = T[lang], linked = sessions.filter((s) => t.sessionIds.includes(s.id));
  const steps: Step[] = [{ kind: "observed", at: bug.created, text: `${x.observed}: ${bug.title}${bug.ref ? ` (${bug.ref})` : ""}` }];
  for (const s of linked) steps.push({ kind: "session", at: s.start, text: `${x.session} #${s.n}${s.summary ? `: ${s.summary.slice(0, 160)}` : ""}` });
  if (t.fix) steps.push({ kind: "fix", at: t.fix.at, text: `${x.fix} (${x[t.fix.state]}): ${t.fix.text.slice(0, 300)}` });
  const ev = t.fix ? linked.flatMap((s) => s.events.filter((e) => e.source === "playtest" && e.at >= t.fix!.at)) : [];
  for (const e of ev) steps.push({ kind: "evidence", at: e.at, ok: e.ok, text: `${x.evidence}: ${e.label}${e.errors[0] ? ` — ${e.errors[0]}` : ""}` });
  if (t.version) steps.push({ kind: "version", at: t.version.at, text: `${x.version}: ${x.shipped} ${t.version.name}` });
  steps.sort((a, b) => a.at.localeCompare(b.at));
  const need = !t.fix || t.fix.state === "rejected" ? x.needFix : t.fix.state === "proposed" ? x.needReview : !ev.some((e) => e.ok) ? x.needTest : !t.version ? x.needVersion : null;
  return { steps, next: need && `${x.missing}: ${need}` };
}
