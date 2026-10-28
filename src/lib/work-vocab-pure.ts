// Roadmap 34: four user-facing names over the existing records. The records (tasks, missions, chains, teams, rules,
// automations, skills, recipes, goals) stay as they are; this only says which name each one goes under. Pure, tested in tests/work-vocab.test.ts.
export type WorkTab = "work" | "routines" | "workflows" | "goals";

export const WORK_TABS: { id: WorkTab; en: string; et: string; records: string[]; say: string; sayEt: string }[] = [
  { id: "work", en: "Work", et: "Töö", records: ["task", "mission", "chain", "team"],
    say: "work, my work, open work, active work, missions", sayEt: "töö, minu töö, ava töö, käimasolev töö" },
  { id: "routines", en: "Routines", et: "Rutiinid", records: ["rule", "automation", "schedule"],
    say: "routines, my routines, standing rules, schedules", sayEt: "rutiinid, minu rutiinid, ava rutiinid, ajakavad" },
  { id: "workflows", en: "Saved workflows", et: "Salvestatud töövood", records: ["skill", "recipe"],
    say: "saved workflows, my saved workflows, workflows, my workflows, recipes, skills", sayEt: "salvestatud töövood, töövood, minu töövood, ava töövood" },
  { id: "goals", en: "Goals", et: "Eesmärgid", records: ["goal"],
    say: "goals, my goals", sayEt: "eesmärgid, minu eesmärgid, ava eesmärgid" },
];

/** Internal record kind ("recipe", "automation") → the name he sees. Unknown kinds stay under Work. */
export const workTabOf = (record: string): WorkTab => WORK_TABS.find((x) => x.records.includes(record.toLowerCase()))?.id ?? "work";
export const workTabName = (tab: WorkTab, lang: "en" | "et" = "en") => { const x = WORK_TABS.find((w) => w.id === tab)!; return lang === "et" ? x.et : x.en; };
export const parseWorkTab = (v: unknown): WorkTab => (WORK_TABS.some((x) => x.id === v) ? (v as WorkTab) : "work");
