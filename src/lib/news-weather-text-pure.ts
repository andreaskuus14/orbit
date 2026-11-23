// News weather UI text, English + Estonian (kept in this file so the shared i18n table isn't touched by this feature).
// tests/news-weather.test.ts checks both languages have the same keys.
export type WxLang = "en" | "et";
export const WX_TEXT = {
  en: {
    kicker: "Intelligence", title: "News weather", howTo: "Map key",
    storm: "Storm", stormIs: "low-pressure centre, 5+ outlets",
    cell: "Cell", cellIs: "still forming, 1–4 outlets",
    front: "Front", frontIs: "one story crossing borders", cold: "Cold front", coldIs: "confirmed, crossing borders",
    warm: "Warm front", warmIs: "still forming, crossing borders", occluded: "Occluded", occludedIs: "joins two storms",
    high: "High", highIs: "high-pressure centre, calm",
    isobars: "Isobars", isobarsIs: "hPa, lower = busier news",
    play: "Play today's briefing", noBriefing: "No briefing yet today", since: "Since you last looked",
    confirmed: "Confirmed by", single: "Single source", of: "of", outlet: "outlet", outlets: "outlets", reports: "reports",
    keys: "Space pause · → next story · Esc back to the weather", paused: "Paused", bright: "Solid line: ORBIT read it in full",
    sources: "Sources", readFull: "read in full", headlineOnly: "headline only", credit: "Relief: Natural Earth · Night lights, clouds: Solar System Scope (CC BY 4.0)",
    next: "Next", classic: "Classic map", weatherMap: "News weather", noVoice: "No voice right now",
    stories: "stories", story: "story", min: "min", s: "s",
  },
  et: {
    kicker: "Luure", title: "Uudiste ilm", howTo: "Kaardi selgitus",
    storm: "Torm", stormIs: "madalrõhkkond, 5+ väljaannet",
    cell: "Rakk", cellIs: "alles tekib, 1–4 väljaannet",
    front: "Front", frontIs: "üks lugu üle piiride", cold: "Külm front", coldIs: "kinnitatud, üle piiride",
    warm: "Soe front", warmIs: "alles tekib, üle piiride", occluded: "Oklusioon", occludedIs: "ühendab kaks tormi",
    high: "Kõrgrõhk", highIs: "kõrgrõhkkond, vaikne",
    isobars: "Isobaarid", isobarsIs: "hPa, madalam = rohkem uudiseid",
    play: "Esita tänane ülevaade", noBriefing: "Täna pole veel ülevaadet", since: "Pärast viimast vaatamist",
    confirmed: "Kinnitanud", single: "Üks allikas", of: "/", outlet: "väljaanne", outlets: "väljaannet", reports: "teadet",
    keys: "Tühik paus · → järgmine lugu · Esc tagasi ilma juurde", paused: "Paus", bright: "Täisjoon: ORBIT luges selle läbi",
    sources: "Allikad", readFull: "loetud läbi", headlineOnly: "ainult pealkiri", credit: "Reljeef: Natural Earth · Öötuled, pilved: Solar System Scope (CC BY 4.0)",
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
