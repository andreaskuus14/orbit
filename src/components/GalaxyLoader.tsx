// Shown while the galaxy's 3D chunk downloads and its first frame compiles. No three.js import: it must render instantly.
export function GalaxyLoader({ done = false }: { done?: boolean }) {
  return (
    <div className={`galaxy-loader${done ? " done" : ""}`} role="status" aria-live="polite" aria-hidden={done || undefined}>
      <div className="galaxy-loader-orb" aria-hidden="true"><i /><i /><i /></div>
      <span>{done ? "" : "Aligning the stars…"}</span>
    </div>
  );
}
