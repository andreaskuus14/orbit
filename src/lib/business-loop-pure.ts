// Daily business loop (roadmap Phase 2): an automation TEMPLATE in OPERATIONS → Automations (nothing runs until he saves it there,
// and he can pause it any time). One daily agent run: find leads matching his condition → verify each on its own public page →
// pick the best → demo site plan + pitch draft → save_lead (an approval: his click files the lead) → the email itself is a second,
// separate approval of the exact text in BUSINESS / Remote (AGENTS.md rule 6). Follow-ups come from the night shift's follow-up
// drafts once he has sent it; the page watch is added with the lead. Pure; tested in tests/business-loop.test.ts.
import { validateProspect, type ProspectInput } from "./business-pure.ts";

export const BUSINESS_LOOP = {
  name: "Daily business loop", when: "day" as const, time: "09:15", agent: "nova",
  prompt: [
    "Daily business loop. CONDITION (edit me): small businesses in Tallinn with no website, or a website that is broken or unusable on a phone.",
    "1. Find: web_search for up to 8 businesses that match the CONDITION.",
    "2. Verify: delegate to atlas to open each one's own public page or listing (fetch_url) and keep only those where the CONDITION is visibly true; note the evidence URL. Never guess a contact: only an email or phone shown on their own page.",
    "3. Pick the single best lead (clear need, a public contact, a business that can pay) and say why in one line.",
    "4. Demo site: delegate to forge a one-page demo site plan for it (sections, headline, 3 selling points, colours) in Markdown.",
    "5. Pitch: write a short, friendly first email in the business's language (max 120 words) that links to nothing yet and offers the demo.",
    "6. Queue: call save_lead (if it says the business is already in the pipeline, take the next best) with name, kind, contact, website, evidence, the demo plan as notes and the pitch. That waits for the owner's approval; the email is sent only after he approves that exact text in BUSINESS. Never send anything yourself.",
    "End with: the lead picked, why, and what waits for his click.",
  ].join("\n"),
};

export type LeadInput = ProspectInput & { draft: string; watch?: string };

/** save_lead tool input → the prospect row (stage lead, draft = the pitch) + an optional public page to watch, or an error. */
export function leadInput(i: Record<string, unknown>): LeadInput | string {
  const site = typeof i.website === "string" ? i.website.trim().slice(0, 300) : "", ev = typeof i.evidence === "string" ? i.evidence.trim().slice(0, 300) : "";
  const p = validateProspect({ ...i, notes: [site && `Website: ${site}`, ev && `Evidence: ${ev}`, typeof i.notes === "string" ? i.notes : ""].filter(Boolean).join("\n") });
  if (typeof p === "string") return p;
  const draft = typeof i.pitch === "string" ? i.pitch.trim().slice(0, 4000) : "";
  if (draft.length < 20) return "pitch: write the first email (at least 20 characters)";
  const watch = /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(site) ? site : undefined;
  return { ...p, draft, ...(watch ? { watch } : {}) };
}
