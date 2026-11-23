// News weather UI text, English + Estonian (kept in this file so the shared i18n table isn't touched by this feature).
// tests/news-weather.test.ts checks both languages have the same keys.
export type WxLang = "en" | "et";
export const WX_TEXT = {
  en: {
    kicker: "INTELLIGENCE", title: "News weather", howTo: "HOW TO READ IT",
    storm: "Storm", stormIs: "a story 5+ independent outlets confirm",
    cell: "Cell", cellIs: "a story still forming (1–4 outlets)",
    front: "Front", frontIs: "one story crossing borders",
    isobars: "Isobars", isobarsIs: "how much news is in the air",
    play: "Play today's briefing", noBriefing: "No briefing yet today", since: "SINCE YOU LAST LOOKED",
    confirmed: "CONFIRMED", single: "SINGLE SOURCE", outlet: "outlet", outlets: "outlets", reports: "reports",
    keys: "Space pause · → next story · Esc back to the weather", paused: "Paused", bright: "Bright beam: ORBIT read it in full",
    next: "Next", classic: "Classic map", weatherMap: "News weather", noVoice: "No voice right now",
    stories: "stories", story: "story", min: "min", s: "s",
  },
  et: {
    kicker: "LUURE", title: "Uudiste ilm", howTo: "KUIDAS LUGEDA",
    storm: "Torm", stormIs: "lugu, mida kinnitab 5+ sõltumatut väljaannet",
    cell: "Rakk", cellIs: "lugu alles tekib (1–4 väljaannet)",
    front: "Front", frontIs: "üks lugu üle piiride",
    isobars: "Isobaarid", isobarsIs: "kui palju uudiseid on õhus",
    play: "Esita tänane ülevaade", noBriefing: "Täna pole veel ülevaadet", since: "PÄRAST VIIMAST VAATAMIST",
    confirmed: "KINNITATUD", single: "ÜKS ALLIKAS", outlet: "väljaanne", outlets: "väljaannet", reports: "teadet",
    keys: "Tühik paus · → järgmine lugu · Esc tagasi ilma juurde", paused: "Paus", bright: "Hele kiir: ORBIT luges selle läbi",
    next: "Järgmine", classic: "Tavaline kaart", weatherMap: "Uudiste ilm", noVoice: "Häält praegu pole",
    stories: "lugu", story: "lugu", min: "min", s: "s",
  },
} as const satisfies Record<WxLang, Record<string, string>>;
export type WxKey = keyof typeof WX_TEXT.en;
export const wxText = (lang: string) => WX_TEXT[lang === "et" ? "et" : "en"];

export const REGION_ET: Record<string, string> = { Americas: "Ameerika", Europe: "Euroopa", "Middle East": "Lähis-Ida", Africa: "Aafrika", Asia: "Aasia", Oceania: "Okeaania" };

/** "6 stories · 1 min 10 s" */
export function tourLength(n: number, ms: number, lang: string): string {
  const t = wxText(lang), sec = Math.round(ms / 1000), m = Math.floor(sec / 60), s = sec % 60;
  const len = m ? `${m} ${t.min}${s ? ` ${s} ${t.s}` : ""}` : `${s} ${t.s}`;
  return `${n} ${n === 1 ? t.story : t.stories} · ${len}`;
}
