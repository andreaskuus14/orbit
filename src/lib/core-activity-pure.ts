// Stream labels describe activity, not proof that an action succeeded.
export function appendActivity(labels: string[], incoming: string): string[] {
  const label = incoming.trim();
  if (!label || labels.at(-1) === label) return labels;
  return [...labels.slice(-4), label];
}
