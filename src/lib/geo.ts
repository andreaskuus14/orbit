// Where is the news? A small gazetteer that tags headlines with countries, for the INTELLIGENCE globe.
// Pure and deterministic: no AI call, works on every stored article. Names match world-atlas (110m) so the
// globe can light up the country shape; lat/lon place the hotspot marker.
// shortcut: keyword matching misses stories that never name a place and can be fooled by homonyms;
// upgrade to tagging each story with the model at briefing time if precision becomes a problem.

export type Country = { name: string; lat: number; lon: number; terms: string[] };

// Terms are matched case-sensitively on word boundaries (proper nouns), so "turkey" the bird or "china" plates don't count.
export const COUNTRIES: Country[] = [
  { name: "United States of America", lat: 39, lon: -98, terms: ["United States", "U.S.", "US", "USA", "America", "American", "Americans", "Washington", "White House", "Pentagon", "Congress", "California", "Texas", "Florida"] },
  { name: "Canada", lat: 57, lon: -101, terms: ["Canada", "Canadian", "Canadians", "Ottawa", "Toronto", "Vancouver", "Quebec"] },
  { name: "Mexico", lat: 23, lon: -102, terms: ["Mexico", "Mexican", "Mexicans", "Mexico City"] },
  { name: "Cuba", lat: 21.5, lon: -79, terms: ["Cuba", "Cuban", "Havana"] },
  { name: "Haiti", lat: 19, lon: -72.5, terms: ["Haiti", "Haitian", "Port-au-Prince"] },
  { name: "Venezuela", lat: 7, lon: -66, terms: ["Venezuela", "Venezuelan", "Caracas"] },
  { name: "Colombia", lat: 4, lon: -73, terms: ["Colombia", "Colombian", "Bogotá", "Bogota"] },
  { name: "Brazil", lat: -10, lon: -52, terms: ["Brazil", "Brazilian", "Brasília", "Brasilia", "Rio de Janeiro", "São Paulo", "Sao Paulo"] },
  { name: "Argentina", lat: -35, lon: -65, terms: ["Argentina", "Argentine", "Argentinian", "Buenos Aires"] },
  { name: "Chile", lat: -33, lon: -71, terms: ["Chile", "Chilean", "Santiago"] },
  { name: "Peru", lat: -10, lon: -76, terms: ["Peru", "Peruvian", "Lima"] },
  { name: "Ecuador", lat: -1.5, lon: -78, terms: ["Ecuador", "Ecuadorian", "Quito"] },
  { name: "Greenland", lat: 72, lon: -40, terms: ["Greenland", "Nuuk"] },
  { name: "United Kingdom", lat: 54, lon: -2, terms: ["United Kingdom", "UK", "U.K.", "Britain", "British", "England", "English", "Scotland", "Scottish", "Wales", "Welsh", "London", "Downing Street"] },
  { name: "Ireland", lat: 53.2, lon: -8, terms: ["Ireland", "Irish", "Dublin"] },
  { name: "France", lat: 46.5, lon: 2.5, terms: ["France", "French", "Paris", "Élysée", "Elysee", "Marseille"] },
  { name: "Germany", lat: 51, lon: 10, terms: ["Germany", "German", "Germans", "Berlin", "Bundestag", "Munich", "Frankfurt"] },
  { name: "Netherlands", lat: 52.2, lon: 5.5, terms: ["Netherlands", "Dutch", "Amsterdam", "The Hague"] },
  { name: "Belgium", lat: 50.6, lon: 4.6, terms: ["Belgium", "Belgian", "Brussels"] },
  { name: "Switzerland", lat: 46.8, lon: 8.2, terms: ["Switzerland", "Swiss", "Geneva", "Zurich", "Davos"] },
  { name: "Austria", lat: 47.6, lon: 14.5, terms: ["Austria", "Austrian", "Vienna"] },
  { name: "Italy", lat: 42.8, lon: 12.5, terms: ["Italy", "Italian", "Italians", "Rome", "Milan", "Vatican"] },
  { name: "Spain", lat: 40.2, lon: -3.6, terms: ["Spain", "Spanish", "Madrid", "Barcelona", "Catalonia"] },
  { name: "Portugal", lat: 39.6, lon: -8, terms: ["Portugal", "Portuguese", "Lisbon"] },
  { name: "Greece", lat: 39.3, lon: 22, terms: ["Greece", "Greek", "Athens"] },
  { name: "Poland", lat: 52, lon: 19.4, terms: ["Poland", "Polish", "Warsaw"] },
  { name: "Czechia", lat: 49.8, lon: 15.5, terms: ["Czechia", "Czech Republic", "Czech", "Prague"] },
  { name: "Hungary", lat: 47.1, lon: 19.4, terms: ["Hungary", "Hungarian", "Budapest"] },
  { name: "Romania", lat: 45.9, lon: 24.9, terms: ["Romania", "Romanian", "Bucharest"] },
  { name: "Moldova", lat: 47.2, lon: 28.5, terms: ["Moldova", "Moldovan", "Chisinau", "Chișinău"] },
  { name: "Serbia", lat: 44.2, lon: 20.8, terms: ["Serbia", "Serbian", "Belgrade"] },
  { name: "Kosovo", lat: 42.6, lon: 20.9, terms: ["Kosovo", "Pristina"] },
  { name: "Sweden", lat: 62, lon: 15, terms: ["Sweden", "Swedish", "Stockholm"] },
  { name: "Norway", lat: 61.5, lon: 9, terms: ["Norway", "Norwegian", "Oslo"] },
  { name: "Finland", lat: 63, lon: 26, terms: ["Finland", "Finnish", "Helsinki"] },
  { name: "Denmark", lat: 56, lon: 9.5, terms: ["Denmark", "Danish", "Copenhagen"] },
  { name: "Estonia", lat: 58.7, lon: 25.5, terms: ["Estonia", "Estonian", "Estonians", "Tallinn", "Tartu"] },
  { name: "Latvia", lat: 56.9, lon: 24.6, terms: ["Latvia", "Latvian", "Riga"] },
  { name: "Lithuania", lat: 55.3, lon: 23.9, terms: ["Lithuania", "Lithuanian", "Vilnius"] },
  { name: "Belarus", lat: 53.7, lon: 28, terms: ["Belarus", "Belarusian", "Minsk"] },
  { name: "Ukraine", lat: 49, lon: 31.5, terms: ["Ukraine", "Ukrainian", "Ukrainians", "Kyiv", "Kiev", "Kharkiv", "Odesa", "Odessa", "Donbas", "Crimea", "Zaporizhzhia"] },
  { name: "Russia", lat: 60, lon: 90, terms: ["Russia", "Russian", "Russians", "Moscow", "Kremlin", "St Petersburg", "Siberia"] },
  { name: "Georgia", lat: 42.2, lon: 43.5, terms: ["Tbilisi"] },
  { name: "Armenia", lat: 40.2, lon: 45, terms: ["Armenia", "Armenian", "Yerevan"] },
  { name: "Azerbaijan", lat: 40.3, lon: 47.7, terms: ["Azerbaijan", "Azerbaijani", "Baku"] },
  { name: "Turkey", lat: 39, lon: 35, terms: ["Türkiye", "Turkish", "Ankara", "Istanbul"] },
  { name: "Israel", lat: 31.4, lon: 34.9, terms: ["Israel", "Israeli", "Israelis", "Jerusalem", "Tel Aviv", "IDF"] },
  { name: "Palestine", lat: 31.9, lon: 35.2, terms: ["Palestine", "Palestinian", "Palestinians", "Gaza", "West Bank", "Hamas", "Rafah"] },
  { name: "Lebanon", lat: 33.9, lon: 35.9, terms: ["Lebanon", "Lebanese", "Beirut", "Hezbollah"] },
  { name: "Syria", lat: 35, lon: 38.5, terms: ["Syria", "Syrian", "Syrians", "Damascus", "Aleppo"] },
  { name: "Jordan", lat: 31.2, lon: 36.5, terms: ["Jordanian", "Amman"] },
  { name: "Iraq", lat: 33, lon: 43.7, terms: ["Iraq", "Iraqi", "Baghdad", "Mosul"] },
  { name: "Iran", lat: 32.5, lon: 54, terms: ["Iran", "Iranian", "Iranians", "Tehran"] },
  { name: "Saudi Arabia", lat: 24, lon: 45, terms: ["Saudi Arabia", "Saudi", "Riyadh", "Jeddah", "Mecca"] },
  { name: "Yemen", lat: 15.6, lon: 47.5, terms: ["Yemen", "Yemeni", "Houthi", "Houthis", "Sanaa", "Aden"] },
  { name: "Oman", lat: 21, lon: 57, terms: ["Oman", "Omani", "Muscat"] },
  { name: "United Arab Emirates", lat: 24, lon: 54, terms: ["United Arab Emirates", "UAE", "Emirati", "Dubai", "Abu Dhabi"] },
  { name: "Qatar", lat: 25.3, lon: 51.2, terms: ["Qatar", "Qatari", "Doha"] },
  { name: "Egypt", lat: 26.8, lon: 30, terms: ["Egypt", "Egyptian", "Cairo", "Suez"] },
  { name: "Libya", lat: 27, lon: 17, terms: ["Libya", "Libyan", "Tripoli", "Benghazi"] },
  { name: "Tunisia", lat: 34, lon: 9.5, terms: ["Tunisia", "Tunisian", "Tunis"] },
  { name: "Algeria", lat: 28, lon: 2.6, terms: ["Algeria", "Algerian", "Algiers"] },
  { name: "Morocco", lat: 31.8, lon: -7, terms: ["Morocco", "Moroccan", "Rabat", "Casablanca"] },
  { name: "Sudan", lat: 15.5, lon: 30, terms: ["Sudan", "Sudanese", "Khartoum", "Darfur"] },
  { name: "S. Sudan", lat: 7.5, lon: 30.5, terms: ["SouthSudan", "Juba"] },
  { name: "Ethiopia", lat: 9, lon: 39.5, terms: ["Ethiopia", "Ethiopian", "Addis Ababa", "Tigray"] },
  { name: "Somalia", lat: 6, lon: 46, terms: ["Somalia", "Somali", "Mogadishu"] },
  { name: "Kenya", lat: 0.3, lon: 37.9, terms: ["Kenya", "Kenyan", "Nairobi"] },
  { name: "Nigeria", lat: 9.5, lon: 8, terms: ["Nigeria", "Nigerian", "Abuja", "Lagos"] },
  { name: "Ghana", lat: 7.9, lon: -1, terms: ["Ghana", "Ghanaian", "Accra"] },
  { name: "Mali", lat: 17.5, lon: -4, terms: ["Mali", "Malian", "Bamako"] },
  { name: "Niger", lat: 17.6, lon: 9.4, terms: ["Niger", "Niamey"] },
  { name: "Burkina Faso", lat: 12.3, lon: -1.6, terms: ["Burkina Faso", "Ouagadougou"] },
  { name: "Dem. Rep. Congo", lat: -2.9, lon: 23.6, terms: ["Democratic Republic of the Congo", "DR Congo", "DRC", "Congolese", "Kinshasa", "Goma"] },
  { name: "South Africa", lat: -29, lon: 24.5, terms: ["South Africa", "South African", "Johannesburg", "Cape Town", "Pretoria"] },
  { name: "Afghanistan", lat: 34, lon: 66, terms: ["Afghanistan", "Afghan", "Kabul", "Taliban"] },
  { name: "Pakistan", lat: 30, lon: 70, terms: ["Pakistan", "Pakistani", "Islamabad", "Karachi", "Lahore"] },
  { name: "India", lat: 22, lon: 79, terms: ["India", "Indian", "Indians", "New Delhi", "Delhi", "Mumbai", "Bengaluru", "Kashmir"] },
  { name: "Bangladesh", lat: 23.8, lon: 90.3, terms: ["Bangladesh", "Bangladeshi", "Dhaka"] },
  { name: "Sri Lanka", lat: 7.8, lon: 80.7, terms: ["Sri Lanka", "Sri Lankan", "Colombo"] },
  { name: "Nepal", lat: 28.3, lon: 84, terms: ["Nepal", "Nepalese", "Nepali", "Kathmandu"] },
  { name: "Kazakhstan", lat: 48, lon: 67, terms: ["Kazakhstan", "Kazakh", "Astana", "Almaty"] },
  { name: "China", lat: 35, lon: 103, terms: ["China", "Chinese", "Beijing", "Shanghai", "Hong Kong", "Xinjiang", "Tibet", "Shenzhen"] },
  { name: "Taiwan", lat: 23.7, lon: 121, terms: ["Taiwan", "Taiwanese", "Taipei"] },
  { name: "Mongolia", lat: 46.8, lon: 103, terms: ["Mongolia", "Mongolian", "Ulaanbaatar"] },
  { name: "North Korea", lat: 40.2, lon: 127.5, terms: ["North Korea", "North Korean", "Pyongyang", "DPRK"] },
  { name: "South Korea", lat: 36.4, lon: 127.9, terms: ["South Korea", "South Korean", "Seoul"] },
  { name: "Japan", lat: 36.5, lon: 138.5, terms: ["Japan", "Japanese", "Tokyo", "Osaka"] },
  { name: "Philippines", lat: 12.5, lon: 122, terms: ["Philippines", "Philippine", "Filipino", "Manila"] },
  { name: "Vietnam", lat: 16, lon: 106.5, terms: ["Vietnam", "Vietnamese", "Hanoi", "Ho Chi Minh City"] },
  { name: "Thailand", lat: 15.5, lon: 101, terms: ["Thailand", "Thai", "Bangkok"] },
  { name: "Myanmar", lat: 21, lon: 96, terms: ["Myanmar", "Burma", "Burmese", "Yangon", "Naypyidaw"] },
  { name: "Cambodia", lat: 12.6, lon: 105, terms: ["Cambodia", "Cambodian", "Phnom Penh"] },
  { name: "Malaysia", lat: 3.8, lon: 102, terms: ["Malaysia", "Malaysian", "Kuala Lumpur"] },
  { name: "Indonesia", lat: -2.5, lon: 118, terms: ["Indonesia", "Indonesian", "Jakarta", "Bali"] },
  { name: "Australia", lat: -25, lon: 134, terms: ["Australia", "Australian", "Australians", "Canberra", "Sydney", "Melbourne"] },
  { name: "New Zealand", lat: -41.5, lon: 172.5, terms: ["New Zealand", "Wellington", "Auckland"] },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One regex per country; boundaries that also work around dots ("U.S.") and accented letters.
const MATCHERS = COUNTRIES.map((c) => ({
  c,
  re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...c.terms].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}\\p{N}])`, "gu"),
}));

// Place names that contain another country's name, rewritten before matching
// ("South Sudan" → one token so "Sudan" doesn't also match; "Niger Delta" is in Nigeria).
const REWRITES: [RegExp, string][] = [
  [/South Sudan/g, "SouthSudan"], [/Niger Delta/g, "Nigeria"],
  [/New (York|Mexico|Jersey|England)/g, "USA"], [/New South Wales/g, "Australia"], [/Indian Ocean/g, "Ocean"], [/Gulf of Mexico/g, "Gulf"],
];
const normalize = (text: string) => REWRITES.reduce((t, [re, to]) => t.replace(re, to), text);

/** Countries a headline (plus optional summary) is about, strongest first, at most `max`. */
export function geoTag(title: string, summary = "", max = 3): string[] {
  const scores = new Map<string, number>();
  const t0 = normalize(title), s0 = normalize(summary);
  for (const { c, re } of MATCHERS) {
    // Title mentions count triple: the subject of a story is usually in its headline.
    const t = t0.match(re)?.length ?? 0;
    const s = s0.match(re)?.length ?? 0;
    if (t || s) scores.set(c.name, t * 3 + s);
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n);
}

export type Story = { title: string; url: string; source: string | null; published_at: string | null };
export type Hotspot = { name: string; lat: number; lon: number; count: number; stories: Story[] };

/** Groups articles by country, busiest first; each keeps its newest stories. */
export function hotspots(articles: (Story & { summary?: string | null })[], perCountry = 8): { hotspots: Hotspot[]; untagged: number } {
  const byName = new Map<string, Hotspot>();
  let untagged = 0;
  for (const a of articles) {
    const tags = geoTag(a.title, (a.summary ?? "").slice(0, 400));
    if (!tags.length) { untagged++; continue; }
    for (const name of tags) {
      const c = COUNTRIES.find((x) => x.name === name)!;
      const h = byName.get(name) ?? { name, lat: c.lat, lon: c.lon, count: 0, stories: [] };
      h.count++;
      h.stories.push({ title: a.title, url: a.url, source: a.source, published_at: a.published_at });
      byName.set(name, h);
    }
  }
  const time = (s: Story) => (s.published_at ? Date.parse(s.published_at) || 0 : 0);
  const list = [...byName.values()].sort((a, b) => b.count - a.count);
  for (const h of list) h.stories = h.stories.sort((a, b) => time(b) - time(a)).slice(0, perCountry);
  return { hotspots: list, untagged };
}

// world-atlas uses short labels for some countries; these read better and search better.
const DISPLAY: Record<string, string> = {
  "United States of America": "United States", "S. Sudan": "South Sudan", "Dem. Rep. Congo": "DR Congo",
  "Central African Rep.": "Central African Republic", "Bosnia and Herz.": "Bosnia and Herzegovina", "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea", "W. Sahara": "Western Sahara", "Solomon Is.": "Solomon Islands", "Falkland Is.": "Falkland Islands",
  "N. Cyprus": "Northern Cyprus", "Fr. S. Antarctic Lands": "French Southern Lands", "Côte d'Ivoire": "Ivory Coast", "eSwatini": "Eswatini",
};
export const displayName = (name: string) => DISPLAY[name] ?? name;

// ---------- importance and regions ----------

// Words that usually mark a consequential story; a rough "how big is this" score for ranking and colour.
const MAJOR: [RegExp, number][] = [
  [/\b(war|invasion|missile|airstrike|strike[sd]?|attack(s|ed)?|killed|dead|deaths|bomb(ing)?|ceasefire|troops|military|drone[s]?)\b/i, 3],
  [/\b(election|vote[sd]?|president|prime minister|parliament|government|coup|protest(s|ers)?|resign(s|ed|ation)?|sanction(s|ed)?|summit|treaty|talks)\b/i, 2],
  [/\b(economy|inflation|recession|central bank|interest rates?|tariff(s)?|markets?|stocks?|oil|gdp|trade|budget|debt|crisis)\b/i, 2],
  [/\b(earthquake|flood(s|ing)?|hurricane|typhoon|wildfire(s)?|disaster|outbreak|pandemic|emergency)\b/i, 3],
  [/\b(breaking|exclusive|first|record|historic)\b/i, 1],
];
/** 0 = routine; 3+ = major (war, disaster, election-level). */
export function importance(title: string): number {
  return MAJOR.reduce((s, [re, w]) => s + (re.test(title) ? w : 0), 0);
}

export const REGIONS: Record<string, { lat: number; lon: number; countries: string[] }> = {
  Americas: { lat: 15, lon: -85, countries: ["United States of America", "Canada", "Mexico", "Cuba", "Haiti", "Venezuela", "Colombia", "Brazil", "Argentina", "Chile", "Peru", "Ecuador", "Greenland"] },
  Europe: { lat: 50, lon: 15, countries: ["United Kingdom", "Ireland", "France", "Germany", "Netherlands", "Belgium", "Switzerland", "Austria", "Italy", "Spain", "Portugal", "Greece", "Poland", "Czechia", "Hungary", "Romania", "Moldova", "Serbia", "Kosovo", "Sweden", "Norway", "Finland", "Denmark", "Estonia", "Latvia", "Lithuania", "Belarus", "Ukraine", "Russia"] },
  "Middle East": { lat: 29, lon: 45, countries: ["Georgia", "Armenia", "Azerbaijan", "Turkey", "Israel", "Palestine", "Lebanon", "Syria", "Jordan", "Iraq", "Iran", "Saudi Arabia", "Yemen", "Oman", "United Arab Emirates", "Qatar", "Egypt"] },
  Africa: { lat: 3, lon: 20, countries: ["Libya", "Tunisia", "Algeria", "Morocco", "Sudan", "S. Sudan", "Ethiopia", "Somalia", "Kenya", "Nigeria", "Ghana", "Mali", "Niger", "Burkina Faso", "Dem. Rep. Congo", "South Africa"] },
  Asia: { lat: 30, lon: 95, countries: ["Afghanistan", "Pakistan", "India", "Bangladesh", "Sri Lanka", "Nepal", "Kazakhstan", "China", "Taiwan", "Mongolia", "North Korea", "South Korea", "Japan", "Philippines", "Vietnam", "Thailand", "Myanmar", "Cambodia", "Malaysia", "Indonesia"] },
  Oceania: { lat: -28, lon: 145, countries: ["Australia", "New Zealand"] },
};
export const regionOf = (name: string) => Object.keys(REGIONS).find((r) => REGIONS[r].countries.includes(name)) ?? null;
