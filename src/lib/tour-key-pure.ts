// The tour's storage key and reopen event, apart from tour-pure.ts so the always-mounted WhatsNew gate stays tiny.
/** Bump with each round worth touring: a new key auto-opens the tour once more. */
export const TOUR_KEY = "orbit.tour.2026-10-27";
export const TOUR_EVENT = "orbit:tour"; // reopen (resume) the tour, e.g. from the Ctrl+K palette
