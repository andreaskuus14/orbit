export function CoreActivity({ labels, streaming }: { labels: string[]; streaming: boolean }) {
  const current = streaming ? "Writing your answer" : labels.at(-1) ?? "Connecting to CORE";
  const previous = streaming ? labels.slice(-3) : labels.slice(0, -1).slice(-3);
  return <div className="core-activity" aria-label="CORE activity">
    {previous.length > 0 && <details><summary>{previous.length} earlier {previous.length === 1 ? "activity" : "activities"}</summary>
      <ol>{previous.map((label, i) => <li key={i}>{label}</li>)}</ol>
    </details>}
    <div className="core-activity-now" role="status"><span className="activity-orbit" aria-hidden="true" /><span><small>NOW</small>{current}</span></div>
  </div>;
}
