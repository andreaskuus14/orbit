// One shared polite live region for UI that appears without taking focus (brief, tour). It is created once and kept,
// because a region mounted together with its text is often not read; the text is set a beat later so it counts as a change.
export function announce(msg: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("orbit-announce");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "orbit-announce", className: "sr-only" });
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.append(el);
  }
  const live = el;
  live.textContent = "";
  setTimeout(() => { live.textContent = msg; }, 150);
}
