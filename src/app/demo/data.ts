import { demoFor } from "@/lib/demo-pure";
import { DEMO_ROUTES } from "@/lib/demo-shell-pure";

/** Only the DEMO_ROUTES responses reach the page (and so the browser); LIFE, BUSINESS and journal fixtures never do. */
export function demoData(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(DEMO_ROUTES).map(([key, endpoint]) => [key, demoFor(endpoint)]));
}
