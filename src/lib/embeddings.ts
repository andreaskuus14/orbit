// Voyage AI embeddings (Anthropic's recommended provider), 1024 dims to match the DB column.
// Optional: without VOYAGE_API_KEY, ORBIT falls back to full-text search only.

export const embeddingsEnabled = () => !!process.env.VOYAGE_API_KEY;

export async function embed(text: string, inputType: "document" | "query"): Promise<number[] | null> {
  if (!embeddingsEnabled()) return null;
  try {
    const res = await fetch(process.env.VOYAGE_API_URL || "https://ai.mongodb.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
      // shortcut: embeds the first 16k chars only; chunk long documents when Phase 4 adds deep document search.
      body: JSON.stringify({ input: [text.slice(0, 16_000)], model: process.env.VOYAGE_MODEL || "voyage-4", input_type: inputType }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("[orbit] embedding failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as { data?: { embedding: number[] }[] };
    const vec = json.data?.[0]?.embedding;
    return vec && vec.length === 1024 ? vec : null;
  } catch (e) {
    console.error("[orbit] embedding error", e);
    return null;
  }
}
