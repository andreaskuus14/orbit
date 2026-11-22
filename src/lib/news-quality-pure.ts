// What goes into a Pulse briefing, pure (tests: tests/news-quality.test.ts). From the 22 Nov briefings and topic searches:
// - topic searches return SEO pages ("buy this AI stock", game-mode guides, promo codes) next to real reporting;
// - sport (NBA, F1, chess) arrived through world feeds and was written up under "World & conflict".

/** Outlets whose topic-search hits are advice, listicles or SEO guides, not reporting. */
const JUNK_SOURCES = /^(the motley fool|motley fool|pro game guides|gamerant guides|dexerto guides|sportskeeda|beebom|benzinga|zacks|investorplace|insidermonkey|simply wall st|seeking alpha)$/i;
/** Headlines of the same kinds: stock tips, guides, codes, tier lists, deals. */
const JUNK_TITLE = /\b(stocks? to buy|buy (this|these|now)|should you buy|(is|are) .{0,40} a buy\b|price prediction|codes? \((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|all (working )?codes|promo codes?|tier list|how to get|guide:|beginner'?s guide|game mode guide|walkthrough|best deals?|deal alert|% off\b|coupon)\b/i;

/** The publisher's name without Microsoft Start's " on MSN" (the story itself is the outlet's). */
export const outletName = (source: string | null | undefined) => (source ?? "").replace(/\s+on MSN$/i, "").trim();

/** True for advice/SEO/deal pages that should not reach a briefing. */
export function isJunk(a: { title: string; source?: string | null }): boolean {
  return JUNK_SOURCES.test(outletName(a.source)) || JUNK_TITLE.test(a.title);
}

const SPORT = /\b(nba|nfl|nhl|mlb|premier league|champions league|la liga|serie a|bundesliga|formula one|formula 1|f1|grand prix|motogp|ufc|wimbledon|us open|world cup qualif\w*|test match|odi|t20|grand slam|world chess championship|olympic(s)? (team|medal)|rebounds|touchdowns?|hat-trick|goalkeeper|striker)\b|\b(scores? \d+ points|wins? .{0,30}(title|cup|trophy|grand prix|championship)|beat[s]? .{0,30} \d+-\d+)\b/i;
/** Sport results and fixtures: not "world" news (they reached the World & conflict section on 22 Nov). */
export const isSport = (title: string) => SPORT.test(title);
