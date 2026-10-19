// Frozen from e5d586a: pure.ts rrfMerge + memory.ts searchMemories' slice.
// Both paths receive the same raw FTS/vector lists. This is not a live database benchmark.
export function legacyMemoryIds(fts: string[], semantic: string[], limit = 8): string[] {
  const scores = new Map<string, number>();
  for (const list of [fts, semantic]) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank + 1)));
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}
