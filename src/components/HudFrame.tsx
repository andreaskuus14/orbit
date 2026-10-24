"use client";
// Always-on cockpit corners over the galaxy (plan #6): four thin brackets, each with a serial in the alien script.
// Static SVG, no animation cost.
import { AlienScript } from "./AlienScript";
import { idGlyphs } from "@/lib/alien-script-pure";

const SERIALS = ["nw", "ne", "se", "sw"].map((c) => ({ c, codes: idGlyphs(`orbit-sol-01-${c}`, 4) }));

export function HudFrame() {
  return (
    <>
      <svg className="hud-frame" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        {["M1.5,9 V1.5 H9", "M91,1.5 H98.5 V9", "M98.5,91 V98.5 H91", "M9,98.5 H1.5 V91"].map((d) => <path key={d} d={d} />)}
      </svg>
      {SERIALS.map((s) => <AlienScript key={s.c} codes={s.codes} r={2.6} stroke={0.8} className={`hud-serial hud-serial-${s.c}`} />)}
    </>
  );
}
