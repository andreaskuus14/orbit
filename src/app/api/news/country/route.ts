import { requireUser } from "@/lib/supabase/server";

// Country facts + economic time series for the globe's country dashboard.
// Source (public, no key): World Bank Open Data for both the facts and the series.
// The id is the ISO 3166-1 numeric code that world-atlas uses for each shape (countries-pure.ts for the rest).

type Point = { y: number; v: number };
const SERIES = {
  gdp: "NY.GDP.MKTP.CD", // GDP, current US$
  growth: "NY.GDP.MKTP.KD.ZG", // GDP growth, annual %
  inflation: "FP.CPI.TOTL.ZG", // consumer prices, annual %
  unemployment: "SL.UEM.TOTL.ZS", // % of labour force
  population: "SP.POP.TOTL",
  area: "AG.SRF.TOTL.K2", // km²
} as const;

// ISO 3166-1 numeric → alpha-3, packed as "004AFG008ALB…" (from i18n-iso-countries codes.json).
const ISO = "004AFG008ALB012DZA016ASM020AND024AGO660AIA010ATA028ATG032ARG051ARM533ABW036AUS040AUT031AZE044BHS048BHR050BGD052BRB112BLR056BEL084BLZ204BEN060BMU064BTN068BOL070BIH072BWA074BVT076BRA086IOT096BRN100BGR854BFA108BDI116KHM120CMR124CAN132CPV136CYM140CAF148TCD152CHL156CHN162CXR166CCK170COL174COM178COG180COD184COK188CRI384CIV191HRV192CUB196CYP203CZE208DNK262DJI212DMA214DOM218ECU818EGY222SLV226GNQ232ERI233EST231ETH238FLK234FRO242FJI246FIN250FRA254GUF258PYF260ATF266GAB270GMB268GEO276DEU288GHA292GIB300GRC304GRL308GRD312GLP316GUM320GTM324GIN624GNB328GUY332HTI334HMD336VAT340HND344HKG348HUN352ISL356IND360IDN364IRN368IRQ372IRL376ISR380ITA388JAM392JPN400JOR398KAZ404KEN296KIR408PRK410KOR414KWT417KGZ418LAO428LVA422LBN426LSO430LBR434LBY438LIE440LTU442LUX446MAC450MDG454MWI458MYS462MDV466MLI470MLT584MHL474MTQ478MRT480MUS175MYT484MEX583FSM498MDA492MCO496MNG500MSR504MAR508MOZ104MMR516NAM520NRU524NPL528NLD540NCL554NZL558NIC562NER566NGA570NIU574NFK580MNP807MKD578NOR512OMN586PAK585PLW275PSE591PAN598PNG600PRY604PER608PHL612PCN616POL620PRT630PRI634QAT638REU642ROU643RUS646RWA654SHN659KNA662LCA666SPM670VCT882WSM674SMR678STP682SAU686SEN690SYC694SLE702SGP703SVK705SVN090SLB706SOM710ZAF239SGS724ESP144LKA729SDN740SUR744SJM748SWZ752SWE756CHE760SYR158TWN762TJK834TZA764THA626TLS768TGO772TKL776TON780TTO788TUN792TUR795TKM796TCA798TUV800UGA804UKR784ARE826GBR840USA581UMI858URY860UZB548VUT862VEN704VNM092VGB850VIR876WLF732ESH887YEM894ZMB716ZWE248ALA535BES531CUW831GGY833IMN832JEY499MNE652BLM663MAF688SRB534SXM728SSD";
const alpha3 = (n: string) => { for (let i = 0; i < ISO.length; i += 6) if (ISO.slice(i, i + 3) === n) return ISO.slice(i + 3, i + 6); return null; };


const cache = new Map<string, { at: number; body: unknown }>();
const DAY = 24 * 3600_000;

async function json(url: string) {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "ORBIT/0.2" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw Object.assign(new Error(`${new URL(url).hostname} answered ${r.status}`), { status: r.status });
  return r.json();
}

async function series(iso3: string, code: string): Promise<Point[]> {
  const year = new Date().getFullYear();
  const j = await json(`https://api.worldbank.org/v2/country/${iso3}/indicator/${code}?format=json&date=${year - 16}:${year}&per_page=40`);
  const rows = (Array.isArray(j) && Array.isArray(j[1]) ? j[1] : []) as { date: string; value: number | null }[];
  return rows.filter((r) => typeof r.value === "number").map((r) => ({ y: Number(r.date), v: r.value as number })).sort((a, b) => a.y - b.y);
}

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  // Kosovo has no ISO numeric code, so it comes as World Bank's own alpha-3 (XKX).
  if (!/^(\d{1,3}|XKX)$/.test(id)) return Response.json({ error: "No statistics for this territory" }, { status: 404 });
  const code = id === "XKX" ? id : id.padStart(3, "0");
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < DAY) return Response.json(hit.body);

  const iso3 = code === "XKX" ? code : alpha3(code);
  if (!iso3) return Response.json({ error: "No statistics for this territory" }, { status: 404 });
  let c: { iso2Code?: string; name?: string; capitalCity?: string; region?: { value?: string }; incomeLevel?: { value?: string } };
  try {
    const j = await json(`https://api.worldbank.org/v2/country/${iso3}?format=json`);
    c = Array.isArray(j) && Array.isArray(j[1]) ? j[1][0] ?? {} : {};
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Country data unavailable" }, { status: 502 });
  }
  if (!c.name) return Response.json({ error: "No statistics for this territory" }, { status: 404 }); // World Bank doesn't cover it
  const out: Record<string, Point[]> = {};
  let complete = true;
  const got = await Promise.allSettled(Object.values(SERIES).map((s) => series(iso3, s)));
  Object.keys(SERIES).forEach((k, i) => { const g = got[i]; out[k] = g.status === "fulfilled" ? g.value : []; if (g.status === "rejected") complete = false; });
  const { area = [], ...rest } = out;
  const body = {
    facts: {
      name: c.name, iso2: /^[A-Z]{2}$/.test(c.iso2Code ?? "") ? c.iso2Code! : null, capital: c.capitalCity || null,
      region: c.region?.value?.trim() || null, income: c.incomeLevel?.value?.trim() || null,
      population: out.population?.at(-1)?.v ?? null, area: area.at(-1)?.v ?? null,
    },
    series: rest,
  };
  // Don't pin a World Bank outage for a day: cache only when every call answered (even with no data).
  if (complete) {
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    cache.set(code, { at: Date.now(), body });
  }
  return Response.json(body);
}
