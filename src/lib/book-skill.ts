// Book to Skill, IO side: read a VAULT book, extract each chapter with the model, store "<book>.skill.json" next to it, and
// load only the relevant parts for an agent's question. Rules and schema: book-skill-pure.ts.
import { askClaude } from "./claude";
import { chapters, CHAPTER_SYSTEM, isSkillFile, parseChapter, parseSkill, pick, skillName, type SkillChapter } from "./book-skill-pure";
import { deleteFile, listVault, readVaultText, saveUpload, VaultError } from "./vault";

const firstJson = (t: string) => { const a = t.indexOf("{"), b = t.lastIndexOf("}"); try { return a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null; } catch { return null; } };

/** Build (or rebuild) the skill for a VAULT file. Returns the skill file's name and how many chapters made it. */
export async function makeSkill(name: string, signal?: AbortSignal): Promise<{ skill: string; chapters: number; skipped: number }> {
  if (isSkillFile(name)) throw new VaultError("That is already a skill file");
  const text = await readVaultText(name, 600_000); // the whole book, capped at ~600k chars (a long book)
  if (!text || text.length < 500) throw new VaultError("No readable text in that file (text, PDF or Word, at least a page)", 415);
  const parts = chapters(text), out: SkillChapter[] = [];
  for (const p of parts) {
    if (signal?.aborted) throw new VaultError("Stopped", 499);
    const r = await askClaude(`Chapter "${p.title}" of "${name}":\n<chapter>\n${p.body}\n</chapter>`, CHAPTER_SYSTEM, { purpose: "book to skill", signal });
    const c = parseChapter(firstJson(r.text));
    if (!("error" in c)) out.push(c);
  }
  if (!out.length) throw new VaultError("The model returned no usable chapter notes", 502);
  const file = skillName(name);
  if ((await listVault()).some((f) => f.name === file)) await deleteFile(file); // rebuild: the old one goes to the trash
  const saved = await saveUpload(new File([JSON.stringify({ title: name.replace(/\.[^.]+$/, ""), source: name, chapters: out }, null, 1)], file, { type: "application/json" }));
  return { skill: saved, chapters: out.length, skipped: parts.length - out.length };
}

/** The parts of a stored skill relevant to a question; null when there's no valid skill under that name. */
export async function loadSkill(name: string, question: string): Promise<string | null> {
  const file = isSkillFile(name) ? name : skillName(name);
  const raw = await readVaultText(file, 400_000);
  const skill = raw ? parseSkill((() => { try { return JSON.parse(raw); } catch { return null; } })()) : null;
  return skill ? pick(skill, question) : null;
}
