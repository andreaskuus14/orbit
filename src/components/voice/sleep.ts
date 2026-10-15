"use client";
import { speakChunk, finish, speechSettings } from "./speak";

/** "Orbit, shut down": say goodbye, then close the window. Chrome only lets a page close a window it opened itself
 *  (like the wake-word app window); a normal tab can't be closed by script, so it goes to the sleep screen instead. */
export async function goToSleep() {
  const bye = "Going to sleep. Say \"Orbit, wake up\" when you need me.";
  if (speechSettings().speak) {
    speakChunk(bye);
    await Promise.race([finish(), new Promise((r) => setTimeout(r, 5000))]);
  }
  window.close();
  setTimeout(() => { if (!window.closed) window.location.replace("/sleep"); }, 300);
}
