// Game moment presets (pure, no imports: the STUDIO UI uses it too). Tested in tests/moments.test.ts.
// "focus" picks what the moment prompt looks for: general highlights, gameplay, or GTA (chases, crashes, police escapes...).
// "auto" (default) decides from the video's title / channel / YouTube category and tags.

export type Focus = "auto" | "general" | "game" | "gta";
export type ResolvedFocus = Exclude<Focus, "auto">;
export const FOCUSES: Focus[] = ["auto", "general", "game", "gta"];

// Games streamers and clip channels post most (2025-26), longest names first inside each alternation so "Call of Duty Warzone" beats "Call of Duty".
// shortcut: a hand-kept list; a game missing here still gets the "game" focus from YouTube's Gaming category or the word "gameplay".
const GAMES: [string, RegExp][] = [
  ["GTA", /\b(gta\s?(v|5|6|vi|online|rp)?|grand theft auto|nopixel|fivem)\b/i],
  ["Red Dead Redemption", /\b(red dead( redemption)?( 2)?|rdr ?2)\b/i],
  ["Fortnite", /\bfortnite\b/i],
  ["Minecraft", /\bminecraft\b/i],
  ["Roblox", /\broblox\b/i],
  ["Call of Duty", /\b(call of duty|warzone|black ops( \d| [a-z]+)?|modern warfare|cod ?(bo\d|mw\d?))\b/i],
  ["Battlefield", /\bbattlefield( \d+)?\b/i],
  ["Valorant", /\bvalorant\b/i],
  ["Counter-Strike", /\b(cs ?2|cs:?go|counter[- ]strike)\b/i],
  ["Apex Legends", /\bapex( legends)?\b/i],
  ["League of Legends", /\b(league of legends|lol ranked)\b/i],
  ["Dota 2", /\bdota ?2?\b/i],
  ["Overwatch", /\boverwatch( 2)?\b/i],
  ["Marvel Rivals", /\bmarvel rivals\b/i],
  ["Rocket League", /\brocket league\b/i],
  ["EA FC", /\b(ea (sports )?fc( \d+)?|fifa ?\d{2})\b/i],
  ["NBA 2K", /\bnba ?2k\d*\b/i],
  ["Elden Ring", /\belden ring( nightreign)?\b/i],
  ["Dark Souls", /\bdark souls\b/i],
  ["Rust", /\brust\b(?! (programming|lang|code))/i],
  ["Escape from Tarkov", /\b(tarkov|escape from tarkov)\b/i],
  ["ARC Raiders", /\barc raiders\b/i],
  ["Dead by Daylight", /\b(dead by daylight|dbd)\b/i],
  ["Lethal Company", /\blethal company\b/i],
  ["R.E.P.O.", /\bR\.E\.P\.O\b|\bREPO\b/],
  ["Peak", /\bpeak\b.*\b(game|climb|co-?op)\b/i],
  ["Schedule I", /\bschedule (1|i)\b/i],
  ["Phasmophobia", /\bphasmophobia\b/i],
  ["Among Us", /\bamong us\b/i],
  ["Chained Together", /\bchained together\b/i],
  ["Hollow Knight", /\bhollow knight( silksong)?|\bsilksong\b/i],
  ["Baldur's Gate 3", /\bbaldur'?s gate( 3)?\b/i],
  ["Pokemon", /\bpok[eé]mon\b/i],
  ["Mario Kart", /\bmario kart( world| \d+)?\b/i],
  ["Smash Bros", /\bsmash bros\b/i],
  ["Zelda", /\bzelda\b/i],
  ["GeoGuessr", /\bgeoguessr\b/i],
  ["Clash Royale", /\bclash royale\b/i],
  ["Brawl Stars", /\bbrawl stars\b/i],
  ["The Sims", /\bthe sims( \d)?\b/i],
  ["Resident Evil", /\bresident evil( \d+)?\b/i],
  ["Five Nights at Freddy's", /\b(fnaf|five nights at freddy'?s)\b/i],
  ["Palworld", /\bpalworld\b/i],
  ["Deadlock", /\bdeadlock\b.*\b(valve|game|ranked)\b/i],
  ["Chess", /\bchess\b/i],
];
const GAME_WORDS = /\b(gameplay|playthrough|let'?s play|walkthrough|speedrun|ranked|boss fight|first time playing|beating|1v1|clutch|no[- ]hit)\b/i;

/** The game a title/channel/tags text names, if any ("GTA" for every GTA flavour). */
export function detectGame(text: string): string | null {
  for (const [name, re] of GAMES) if (re.test(text)) return name;
  return null;
}

/** What "auto" means for this video: GTA when it names GTA, game when it names another game, is in YouTube's Gaming category
 *  or says gameplay/speedrun/ranked..., else general. An explicit focus always wins. */
export function resolveFocus(focus: Focus | undefined, o: { text: string; categories?: string[] }): { focus: ResolvedFocus; game: string | null } {
  const game = detectGame(o.text);
  if (focus && focus !== "auto") return { focus, game: focus === "gta" ? "GTA" : focus === "general" ? null : game };
  if (game === "GTA") return { focus: "gta", game };
  if (game || (o.categories ?? []).some((c) => /^gaming$/i.test(c)) || GAME_WORDS.test(o.text)) return { focus: "game", game };
  return { focus: "general", game: null };
}

const GAME_GUIDE = `
GAMEPLAY VIDEO: what makes a gaming Short work, look for these first:
- clutch plays and big wins (1vX, last-second saves, comebacks), and big losses or throws
- fails, deaths that come out of nowhere, glitches, ragdoll physics, funny bugs
- jump scares and rage: the streamer's scream, laugh, swearing or stunned silence is the payoff, the gameplay is the setup
- chat or teammates reacting, trash talk, a funny call-out
Start 1-3 s before the action begins (the setup must be readable in 2 s), end right after the reaction. Skip menus, loading screens, lobby
waiting, settings talk and long strategy explanations. A moment that is only gameplay with no reaction rarely works.`;

const GTA_GUIDE = `${GAME_GUIDE}
GTA SPECIFICALLY (GTA V / Online / RP servers): the best GTA Shorts are
- police chases and escapes: wanted stars climbing, a getaway that barely works, or "BUSTED"
- crashes: cars, bikes, planes, helicopters, ragdolls, "WASTED" right after a confident line
- fights, shootouts, heists that go wrong
- roleplay (RP) drama: in-character arguments, arrests, court, a perfectly timed funny line, a troll
- huge reactions to any of the above
Keep the whole chase/crash beat: a 2-4 s setup, the peak, and the reaction or "WASTED"/"BUSTED" screen.`;

/** Extra moment-picking guidance for the scout and rank prompts ("" for general). */
export const focusGuide = (f: ResolvedFocus) => (f === "gta" ? GTA_GUIDE : f === "game" ? GAME_GUIDE : "");

/** Short label for the UI. */
export const focusLabel = (f: Focus) => ({ auto: "Auto", general: "General", game: "🎮 Game", gta: "🚓 GTA" }[f]);
