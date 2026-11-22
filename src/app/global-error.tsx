"use client";
// Last resort when the root layout itself fails (planet sections have their own PlanetBoundary). Plain HTML: no app CSS loads here.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#02040b", color: "#e6edf5", font: "15px/1.5 system-ui, sans-serif" }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>ORBIT hit a problem</h1>
          <p style={{ color: "#94a3b8" }}>Nothing you did. Reload to continue; the error is in the console and crash log.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 18px", borderRadius: 8, border: "1px solid #22d3ee", background: "transparent", color: "#e6edf5", cursor: "pointer" }}>Reload</button>
        </main>
      </body>
    </html>
  );
}
