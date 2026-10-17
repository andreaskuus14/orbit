// Every UN member state (plus observers Palestine and the Vatican, and Kosovo and Taiwan), so any country can be
// opened on the INTELLIGENCE globe even when the 110m world-atlas has no shape for it (Malta, Singapore, island states).
// Pure (no DOM) — tested in tests/countries.test.ts.
// name = the world-atlas name when the atlas has the country (so it matches the globe, gazetteer and regions);
// id = ISO 3166-1 numeric (what /api/news/country takes; Kosovo has none, so its World Bank code); lang = Google News language.
// lat/lon only for countries the atlas lacks: they get a clickable marker there.

export type WorldCountry = { iso2: string; id: string; name: string; lang: string; lat?: number; lon?: number };

const RAW = `AF|004|Afghanistan|fa
AL|008|Albania|sq
DZ|012|Algeria|ar
AD|020|Andorra|ca|42.51|1.52
AO|024|Angola|pt
AG|028|Antigua and Barbuda|en|17.12|-61.85
AR|032|Argentina|es
AM|051|Armenia|hy
AU|036|Australia|en
AT|040|Austria|de
AZ|031|Azerbaijan|az
BS|044|Bahamas|en
BH|048|Bahrain|ar|26.07|50.55
BD|050|Bangladesh|bn
BB|052|Barbados|en|13.19|-59.54
BY|112|Belarus|ru
BE|056|Belgium|fr
BZ|084|Belize|en
BJ|204|Benin|fr
BT|064|Bhutan|en
BO|068|Bolivia|es
BA|070|Bosnia and Herz.|bs
BW|072|Botswana|en
BR|076|Brazil|pt
BN|096|Brunei|ms
BG|100|Bulgaria|bg
BF|854|Burkina Faso|fr
BI|108|Burundi|fr
CV|132|Cabo Verde|pt|15.0|-23.6
KH|116|Cambodia|km
CM|120|Cameroon|fr
CA|124|Canada|en
CF|140|Central African Rep.|fr
TD|148|Chad|fr
CL|152|Chile|es
CN|156|China|zh
CO|170|Colombia|es
KM|174|Comoros|fr|-11.7|43.25
CG|178|Congo|fr
CD|180|Dem. Rep. Congo|fr
CR|188|Costa Rica|es
CI|384|Côte d'Ivoire|fr
HR|191|Croatia|hr
CU|192|Cuba|es
CY|196|Cyprus|el
CZ|203|Czechia|cs
DK|208|Denmark|da
DJ|262|Djibouti|fr
DM|212|Dominica|en|15.41|-61.37
DO|214|Dominican Rep.|es
EC|218|Ecuador|es
EG|818|Egypt|ar
SV|222|El Salvador|es
GQ|226|Eq. Guinea|es
ER|232|Eritrea|en
EE|233|Estonia|et
SZ|748|eSwatini|en
ET|231|Ethiopia|en
FJ|242|Fiji|en
FI|246|Finland|fi
FR|250|France|fr
GA|266|Gabon|fr
GM|270|Gambia|en
GE|268|Georgia|ka
DE|276|Germany|de
GH|288|Ghana|en
GR|300|Greece|el
GD|308|Grenada|en|12.12|-61.68
GT|320|Guatemala|es
GN|324|Guinea|fr
GW|624|Guinea-Bissau|pt
GY|328|Guyana|en
HT|332|Haiti|fr
HN|340|Honduras|es
HU|348|Hungary|hu
IS|352|Iceland|is
IN|356|India|en
ID|360|Indonesia|id
IR|364|Iran|fa
IQ|368|Iraq|ar
IE|372|Ireland|en
IL|376|Israel|he
IT|380|Italy|it
JM|388|Jamaica|en
JP|392|Japan|ja
JO|400|Jordan|ar
KZ|398|Kazakhstan|ru
KE|404|Kenya|en
KI|296|Kiribati|en|1.45|173.0
KP|408|North Korea|ko
KR|410|South Korea|ko
KW|414|Kuwait|ar
KG|417|Kyrgyzstan|ru
LA|418|Laos|lo
LV|428|Latvia|lv
LB|422|Lebanon|ar
LS|426|Lesotho|en
LR|430|Liberia|en
LY|434|Libya|ar
LI|438|Liechtenstein|de|47.14|9.52
LT|440|Lithuania|lt
LU|442|Luxembourg|fr
MG|450|Madagascar|fr
MW|454|Malawi|en
MY|458|Malaysia|en
MV|462|Maldives|en|4.18|73.51
ML|466|Mali|fr
MT|470|Malta|en|35.9|14.51
MH|584|Marshall Islands|en|7.1|171.38
MR|478|Mauritania|ar
MU|480|Mauritius|en|-20.2|57.5
MX|484|Mexico|es
FM|583|Micronesia|en|6.92|158.16
MD|498|Moldova|ro
MC|492|Monaco|fr|43.74|7.42
MN|496|Mongolia|mn
ME|499|Montenegro|sr
MA|504|Morocco|fr
MZ|508|Mozambique|pt
MM|104|Myanmar|my
NA|516|Namibia|en
NR|520|Nauru|en|-0.53|166.93
NP|524|Nepal|ne
NL|528|Netherlands|nl
NZ|554|New Zealand|en
NI|558|Nicaragua|es
NE|562|Niger|fr
NG|566|Nigeria|en
MK|807|Macedonia|mk
NO|578|Norway|no
OM|512|Oman|ar
PK|586|Pakistan|en
PW|585|Palau|en|7.5|134.62
PA|591|Panama|es
PG|598|Papua New Guinea|en
PY|600|Paraguay|es
PE|604|Peru|es
PH|608|Philippines|en
PL|616|Poland|pl
PT|620|Portugal|pt
QA|634|Qatar|ar
RO|642|Romania|ro
RU|643|Russia|ru
RW|646|Rwanda|en
KN|659|Saint Kitts and Nevis|en|17.3|-62.73
LC|662|Saint Lucia|en|13.91|-60.98
VC|670|Saint Vincent and the Grenadines|en|13.25|-61.2
WS|882|Samoa|en|-13.76|-172.1
SM|674|San Marino|it|43.94|12.46
ST|678|São Tomé and Príncipe|pt|0.33|6.73
SA|682|Saudi Arabia|ar
SN|686|Senegal|fr
RS|688|Serbia|sr
SC|690|Seychelles|en|-4.62|55.45
SL|694|Sierra Leone|en
SG|702|Singapore|en|1.35|103.82
SK|703|Slovakia|sk
SI|705|Slovenia|sl
SB|090|Solomon Is.|en
SO|706|Somalia|so
ZA|710|South Africa|en
SS|728|S. Sudan|en
ES|724|Spain|es
LK|144|Sri Lanka|en
SD|729|Sudan|ar
SR|740|Suriname|nl
SE|752|Sweden|sv
CH|756|Switzerland|de
SY|760|Syria|ar
TJ|762|Tajikistan|ru
TZ|834|Tanzania|en
TH|764|Thailand|th
TL|626|Timor-Leste|pt
TG|768|Togo|fr
TO|776|Tonga|en|-21.14|-175.2
TT|780|Trinidad and Tobago|en
TN|788|Tunisia|fr
TR|792|Turkey|tr
TM|795|Turkmenistan|ru
TV|798|Tuvalu|en|-8.52|179.2
UG|800|Uganda|en
UA|804|Ukraine|uk
AE|784|United Arab Emirates|ar
GB|826|United Kingdom|en
US|840|United States of America|en
UY|858|Uruguay|es
UZ|860|Uzbekistan|ru
VU|548|Vanuatu|en
VE|862|Venezuela|es
VN|704|Vietnam|vi
YE|887|Yemen|ar
ZM|894|Zambia|en
ZW|716|Zimbabwe|en
PS|275|Palestine|ar
VA|336|Vatican City|it|41.9|12.45
XK|XKX|Kosovo|sq
TW|158|Taiwan|zh`;

export const WORLD: WorldCountry[] = RAW.split("\n").map((line) => {
  const [iso2, id, name, lang, lat, lon] = line.split("|");
  return lat ? { iso2, id, name, lang, lat: Number(lat), lon: Number(lon) } : { iso2, id, name, lang };
});

const BY_NAME = new Map(WORLD.map((c) => [c.name, c]));
const BY_ISO2 = new Map(WORLD.map((c) => [c.iso2, c]));
export const countryByName = (name: string) => BY_NAME.get(name) ?? null;
export const countryByIso2 = (cc: string) => BY_ISO2.get(cc.toUpperCase()) ?? null;

/** Picker lookup: what the user typed (any case, display or atlas name, or ISO2) → the country, or null. */
export function findCountry(typed: string, display: (n: string) => string = (n) => n): WorldCountry | null {
  const t = typed.trim().toLowerCase();
  if (!t) return null;
  if (/^[a-z]{2}$/.test(t)) return countryByIso2(t);
  return WORLD.find((c) => c.name.toLowerCase() === t || display(c.name).toLowerCase() === t) ?? null;
}
