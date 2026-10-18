// Shown when "Orbit, shut down" can't close the tab itself. Nothing runs here: no galaxy, no mic.
export default function Sleep() {
  return (
    <main className="grid h-dvh place-items-center text-center">
      <div className="space-y-3">
        <p className="brand text-2xl tracking-[0.3em]">Orbital</p>
        <p className="muted">Asleep. Close this tab, or say “Orbit, wake up”.</p>
        <a className="chip" href="/">Wake up here</a>
      </div>
    </main>
  );
}
