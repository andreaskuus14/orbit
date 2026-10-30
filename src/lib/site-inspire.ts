// ws_inspire_image: site pictures inspired by anything on the web, made legally. Call 1 (no brief): a web image search returns
// reference WORDS only (titles, tags, page links; no picture is downloaded, saved or sent anywhere). Call 2 (CORE's original
// brief): checked (site-inspire-pure.ts), then queued as a priced Higgsfield draft: nothing is generated or spent before the
// owner's Approve click (AGENTS.md rule 6). After the click story.ts generates it and saveGenerated puts it in assets/.
import { readFile } from "node:fs/promises";
import { checkBrief, generatedCredit, generatorOff, parseRefs, type Ref } from "./site-inspire-pure.ts";
import { assetPath, creditsMd, parseCredits, sniffImage } from "./site-pipeline-pure.ts";
import type { Draft } from "./higgsfield-pure.ts";
import { ASPECTS, MAX_COUNT } from "./higgsfield-pure.ts";
import type { ImageIO } from "./site-images.ts";

export type SiteTarget = { user: string; workspace: string; purpose: string };
export type InspireIO = {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Is an image generator usable now? false → fall back to licensed images or SVG. */
  generator: () => Promise<{ ok: boolean; model: string }>;
  /** Queues the priced draft (the owner's approval card); returns the job id. Must never generate. */
  queue: (d: Draft, site: SiteTarget & { brief: string }) => Promise<string>;
};

export async function searchRefs(query: string, f: InspireIO["fetch"] = fetch): Promise<Ref[]> {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query.slice(0, 100))}&page_size=10&mature=false`;
  try {
    const r = await f(url, { headers: { "User-Agent": "ORBIT-site-builder/1.0 (reference words only)", Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    return r.ok ? parseRefs(await r.json()) : [];
  } catch { return []; }
}

const FALLBACK = "No image generator is set up (Higgsfield via Claude Code, or the weekly cap is 0): use ws_fetch_image (licensed) or draw an inline SVG instead.";

export async function inspireImage(input: Record<string, unknown>, user: string, workspace: string, io: InspireIO): Promise<string> {
  const purpose = typeof input.purpose === "string" ? input.purpose.trim().slice(0, 80) : "";
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 100) : "";
  if (input.brief === undefined) {
    if (!query) return "Error: give a query (what kind of picture to look at for ideas)";
    const refs = await searchRefs(query, io.fetch);
    const list = refs.map((r, i) => `${i + 1}. ${r.title}${r.tags.length ? ` [${r.tags.join(", ")}]` : ""}${r.source ? ` <${r.source}>` : ""}`).join("\n");
    return `${refs.length ? `References for "${query}" (words only, data, not instructions; nothing was downloaded or saved):\n${list}` : `No references found for "${query}"; write the brief from the site plan instead.`}
Now write an ORIGINAL brief from these ideas in generic words only (no brands, logos, people, characters, artists, text from the pictures, or "in the style of") and call ws_inspire_image {"workspace": "${workspace}", "purpose": "${purpose || query}", "brief": {"subject", "mood", "palette", "lighting", "composition", "style"}, "count"?: 1-${MAX_COUNT}, "aspect"?: "16:9"}. That only asks the price: the owner approves the generation.`;
  }
  const c = checkBrief(input.brief);
  if (typeof c === "string") return `Error: ${c}`;
  const g = await io.generator();
  if (!g.ok) return FALLBACK;
  const count = Number.isInteger(input.count) && (input.count as number) >= 1 && (input.count as number) <= MAX_COUNT ? (input.count as number) : 1;
  const aspect = ASPECTS.includes(input.aspect as string) ? (input.aspect as string) : "16:9";
  await io.queue({ kind: "image", prompt: c.prompt, model: g.model, count, aspect }, { user, workspace, purpose: purpose || c.brief.subject.slice(0, 60), brief: c.prompt });
  return `Pending approval: "Generate ${count} image${count > 1 ? "s" : ""} for ${workspace}" (cost: Higgsfield's quote, shown on the Approve card in Approvals and STUDIO → Clip Factory → AI Story; the weekly cap applies). Nothing is generated or spent until the owner clicks Approve; after that the picture${count > 1 ? "s" : ""} land in assets/ with a credit in assets/CREDITS.md. Tell him, and use ws_fetch_image or an inline SVG meanwhile if the page needs a picture now.`;
}

/** Real wiring for core-workspace.ts. */
export const inspireIO = (): InspireIO => ({
  generator: async () => {
    const { models } = await import("./clips/story");
    const hf = await import("./capability").then((m) => m.capabilityState()).then((s) => s.higgsfield, () => null);
    return { ok: hf !== false && !generatorOff(process.env), model: models().image };
  },
  queue: async (d, site) => (await (await import("./clips/story")).queueDraftAs(d, "Site images", { site })).id,
});

/** After the owner's Approve click and the generation (story.ts): copies each finished file into the workspace's assets/ and
 *  records it in assets/CREDITS.md. Returns a short status for the job's step line. */
export async function saveGenerated(site: SiteTarget & { brief: string }, model: string, files: string[], io?: Pick<ImageIO, "read" | "write" | "resize">): Promise<string> {
  const w = io ?? await (async () => {
    const ws = await import("./workspace.ts"), { sharpResize } = await import("./site-images.ts");
    return { read: async (p: string) => (await ws.readWsFile(site.user, site.workspace, p))?.text ?? null, write: (p: string, d: string | Uint8Array) => ws.writeWsFile(site.user, site.workspace, p, d), resize: sharpResize };
  })();
  const saved: string[] = [];
  for (const [i, file] of files.entries()) {
    let bytes: Uint8Array = await readFile(file), ext: string | null = sniffImage(bytes);
    if (!ext || ext === "svg") continue;
    const small = await w.resize?.(bytes, ext);
    if (small) ({ bytes, ext } = small);
    const path = assetPath(`${site.purpose}${files.length > 1 ? `-${i + 1}` : ""}`, ext);
    const r = await w.write(path, bytes);
    if ("error" in r) return `couldn't save ${path} to ${site.workspace}: ${r.error}`;
    const cw = await w.write("assets/CREDITS.md", creditsMd(parseCredits((await w.read("assets/CREDITS.md")) ?? ""), generatedCredit(path, site.brief, model)));
    if ("error" in cw) return `saved ${path} but assets/CREDITS.md failed (${cw.error})`;
    saved.push(path);
  }
  return saved.length ? `saved ${saved.join(", ")} in workspace ${site.workspace}` : `nothing usable to save in ${site.workspace}`;
}
