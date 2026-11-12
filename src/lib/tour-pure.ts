// "What's new" guided tour: chapters of 1–2 sentence steps, each with an optional "Show me" target and a setup hint.
// Pure (no DOM): the data, the progress rules and the stored-progress parser. UI: components/WhatsNew.tsx. Tests: tests/tour.test.ts.
// Step text is bilingual here (one place per step); the tour's buttons and labels live in i18n-pure ("tour.*").
import type { NavTarget } from "./nav-pure.ts";
import type { Lang } from "./i18n-pure.ts";

export { TOUR_KEY, TOUR_EVENT } from "./tour-key-pure.ts"; // bump TOUR_KEY there

type Text = Record<Lang, string>;
export type SetupId = "migrations" | "vapid" | "shortcuts" | "ollama" | "capsule" | "resend" | "twilio";
export type Step = { id: string; icon: string; title: Text; text: Text; go?: NavTarget; event?: "palette"; setup?: SetupId };
export type Chapter = { id: string; icon: string; title: Text; steps: Step[] };

const DOCS = "https://github.com/andreaskuus14/orbit/blob/main/docs/";
/** doc = file#anchor under docs/ (anchors are checked against the headings in tests). */
export const SETUP: Record<SetupId, { text: Text; doc: string }> = {
  migrations: { doc: "SETUP.md#1-supabase-migrations-in-order", text: {
    en: "Run migrations 0018, 0019 and 0020 once, in order, in Supabase → SQL Editor.",
    et: "Käivita migratsioonid 0018, 0019 ja 0020 üks kord ja järjest: Supabase → SQL Editor." } },
  vapid: { doc: "SETUP.md#4-push-notifications-vapid-keys", text: {
    en: "Run npm run remote:vapid, paste both lines into .env.local, restart ORBIT, then tap Enable notifications on the phone.",
    et: "Käivita npm run remote:vapid, kleebi mõlemad read faili .env.local, taaskäivita ORBIT ja vajuta telefonis „Lülita teavitused sisse“." } },
  shortcuts: { doc: "SETUP.md#5-siri--watch-shortcuts-tokens", text: {
    en: "Profile → Phone remote → Shortcuts & Watch → New token, one per Shortcut (shown only once).",
    et: "Profiil → Telefonipult → Shortcuts & Watch → New token, iga Shortcuti jaoks oma (näidatakse ainult üks kord)." } },
  ollama: { doc: "SETUP.md#8-optional-windows-extras", text: {
    en: "Install Ollama, run ollama pull llama3.1:8b, set ORBIT_LOCAL_MODEL=llama3.1:8b in .env.local and restart.",
    et: "Paigalda Ollama, käivita ollama pull llama3.1:8b, pane .env.local faili ORBIT_LOCAL_MODEL=llama3.1:8b ja taaskäivita." } },
  capsule: { doc: "SETUP.md#9-time-capsule-backups", text: {
    en: "Profile → Time capsule: pick a folder and a passphrase. Write the passphrase down: without it backups can't be opened.",
    et: "Profiil → Time capsule: vali kaust ja salafraas. Kirjuta salafraas üles: ilma selleta varukoopiaid avada ei saa." } },
  resend: { doc: "SETUP.md#7-resend-email-business-approve--send", text: {
    en: "Add RESEND_API_KEY and ORBIT_MAIL_FROM to .env.local. Without them nothing is emailed; you copy drafts yourself.",
    et: "Lisa .env.local faili RESEND_API_KEY ja ORBIT_MAIL_FROM. Ilma nendeta ei saadeta midagi; kopeerid mustandid ise." } },
  twilio: { doc: "PHONE.md#voice-calls-orbit-wants-to-talk", text: {
    en: "Calls ring the Remote app on your iPhone (needs push). Calling a real phone number (Twilio) isn't set up yet.",
    et: "Kõned helisevad iPhone'i Remote'i rakenduses (vajab teavitusi). Päris telefoninumbrile helistamine (Twilio) pole veel seadistatud." } },
};
export const setupUrl = (id: SetupId) => DOCS + SETUP[id].doc;

const s = (id: string, icon: string, en: [string, string], et: [string, string], more: Partial<Step> = {}): Step =>
  ({ id, icon, title: { en: en[0], et: et[0] }, text: { en: en[1], et: et[1] }, ...more });

export const CHAPTERS: Chapter[] = [
  { id: "week", icon: "✦", title: { en: "This week", et: "Sel nädalal" }, steps: [
    s("wk-goal-card", "🎯", ["Idea → goal", "Tell CORE a rough idea and it writes a goal card with done-checks and what it guessed. Start, Change… or Not now are buttons, not typing."],
      ["Ideest eesmärk", "Räägi CORE'ile toores idee ja see kirjutab eesmärgikaardi valmis-kontrollide ja oma oletustega. Start, Change… ja Not now on nupud, mitte trükkimine."], { go: { panel: "core" } }),
    s("wk-file-cards", "📎", ["Files as cards", "CORE hands over files as cards. Preview, download, get a zip or save to VAULT."],
      ["Failid kaartidena", "CORE annab failid üle kaartidena. Vaata eelvaadet, laadi alla, võta zip või salvesta VAULTi."], { go: { panel: "core" } }),
    s("wk-workspaces", "🗂", ["Workspaces on every planet", "Each planet now has views: BUSINESS has Today, Pipeline, Clients and Money; MEMORY has Search, Recent, Projects, People and Review."],
      ["Tööruumid igal planeedil", "Igal planeedil on nüüd vaated: BUSINESSis Today, Pipeline, Clients ja Money; MEMORYs Search, Recent, Projects, People ja Review."], { go: { panel: "business" } }),
    s("wk-links", "🔗", ["Links to the exact record", "A link opens the exact task, goal, memory or client. Back and refresh keep your place."],
      ["Lingid täpsele kirjele", "Link avab täpselt selle ülesande, eesmärgi, mälestuse või kliendi. Tagasi ja värskendus jätavad sind samasse kohta."], { go: { panel: "memory" } }),
    s("wk-ops-recover", "🛠", ["Recover a failed step", "OPERATIONS uses one set of statuses; a failed step can be retried, resumed, given a new input or abandoned without redoing finished work. Automations show a preview of their next runs."],
      ["Ebaõnnestunud sammu päästmine", "OPERATIONS kasutab üht olekute komplekti; ebaõnnestunud sammu saab uuesti proovida, jätkata, uue sisendiga anda või loobuda ilma tehtud tööd kordamata. Automaatikad näitavad järgmiste käivituste eelvaadet."], { go: { panel: "operations" } }),
    s("wk-needs-you", "🔔", ["Needs you", "One notice per problem, held back while you focus or watch a video. After you've been away you get one digest instead."],
      ["Vajab sind", "Üks teade probleemi kohta, mis ootab, kuni keskendud või vaatad videot. Kui olid eemal, saad selle asemel ühe kokkuvõtte."], { go: { panel: null, mission: true } }),
    s("wk-memory", "🧠", ["MEMORY review", "Capturing the same thing twice doesn't duplicate it, and everything to check sits in one Review queue. Handover packs and people/project suggestions come with their evidence."],
      ["MEMORY ülevaatus", "Sama asja kaks korda salvestamine ei tee duplikaati ja kõik kontrollimist vajav on ühes Review järjekorras. Üleandmispaketid ning inimeste ja projektide soovitused tulevad koos tõenditega."], { go: { panel: "memory" } }),
    s("wk-vault", "🗄", ["VAULT trash and backups", "Deleted files go to trash and can be restored, and backup state says plainly what is and isn't backed up. Renamed files keep their links."],
      ["VAULTi prügikast ja varukoopiad", "Kustutatud failid lähevad prügikasti ja neid saab taastada ning varunduse olek ütleb ausalt, mis on varundatud ja mis mitte. Ümbernimetatud failide lingid jäävad tööle."], { go: { panel: "vault" } }),
    s("wk-studio", "🎬", ["STUDIO production record", "Each video has a production record with its rights basis checked before publishing, and approval is tied to the exact version. Real video checks run, and failures land in the Failed list."],
      ["STUDIO tootmiskirje", "Igal videol on tootmiskirje, mille õiguste alus kontrollitakse enne avaldamist, ja kinnitus kehtib ainult täpselt sellele versioonile. Videoid kontrollitakse päriselt ja vead jõuavad Failed nimekirja."], { go: { panel: "studio", view: "failed" } }),
    s("wk-safety", "🛡", ["Still your click", "Sending, spending and publishing still need your own click. Your journal never goes to a model."],
      ["Ikka sinu klõps", "Saatmine, kulutamine ja avaldamine vajavad endiselt sinu enda klõpsu. Sinu päevik ei lähe kunagi mudelile."], { go: { panel: "profile" } }),
  ] },
  { id: "core", icon: "◉", title: { en: "CORE & missions", et: "CORE ja missioonid" }, steps: [
    s("missions", "🧭", ["Missions", "A multi-step request becomes a mission with steps, receipts and checkpoints. Pause, resume or retry it in AGENTS → Missions."],
      ["Missioonid", "Mitmesammulisest palvest saab missioon sammude, kviitungite ja kontrollpunktidega. Peata, jätka või proovi uuesti: AGENDID → Missions."],
      { go: { panel: "agents" }, setup: "migrations" }),
    s("plan-day", "🗓", ["Plan my day", "Say “plan my day” for a time-blocked plan and a commitment inbox. In the evening, mark each thing done or missed."],
      ["Planeeri mu päev", "Ütle „plan my day“ ja saad ajaplokkidega plaani ning lubaduste postkasti. Õhtul märgi iga asi tehtuks või tegemata."], { go: { panel: "core" } }),
    s("loops", "🪢", ["Open loops", "Each night ORBIT lists things left hanging: promises, replies you're waiting on, stalled goals, unpaid invoices. Close, Snooze or Turn into task in mission control."],
      ["Lahtised otsad", "Igal ööl loetleb ORBIT ripakile jäänud asjad: lubadused, ootel vastused, seisma jäänud eesmärgid, maksmata arved. Sulge, lükka edasi või tee ülesandeks missioonikeskuses."], { go: { panel: null, mission: true } }),
    s("week", "📈", ["Ask about your week", "Ask “what slipped?” or “how did my week go?”. Every answer cites the goal, task or clip it comes from."],
      ["Küsi oma nädala kohta", "Küsi „what slipped?“ või „how did my week go?“. Iga vastus viitab eesmärgile, ülesandele või klipile, kust see tuleb."], { go: { panel: "core" } }),
    s("screen", "🖥", ["Look at my screen", "Ctrl+Shift+L: ORBIT takes one picture of the window you pick and asks CORE about it. The picture isn't saved."],
      ["Vaata mu ekraani", "Ctrl+Shift+L: ORBIT teeb sinu valitud aknast ühe pildi ja küsib selle kohta CORE'ilt. Pilti ei salvestata."], { go: { panel: "core" } }),
    s("twin", "◐", ["The other side", "Before big decisions ORBIT's twin lists 3 risks and the best alternative. It never blocks anything."],
      ["Teine pool", "Enne suuri otsuseid loetleb ORBITi kaksik 3 riski ja parima alternatiivi. See ei blokeeri kunagi midagi."], { go: { panel: "core" } }),
    s("memos", "🎙", ["Voice memos", "Hold to record in CORE or on the phone. Whisper on the PC transcribes and files it; Change or Undo if it filed it wrong."],
      ["Häälmemod", "Hoia salvestamiseks all CORE'is või telefonis. Whisper arvutis kirjutab selle üles ja paigutab; vale koha puhul vajuta Change või Undo."], { go: { panel: "core" } }),
    s("skills", "🧩", ["Skills", "Ask for the same multi-step thing 3+ times and ORBIT proposes a skill. Keep it, then say “run skill <name>”."],
      ["Oskused", "Kui küsid sama mitmesammulist asja 3+ korda, pakub ORBIT välja oskuse. Hoia see alles ja ütle „run skill <nimi>“."], { go: { panel: "agents" } }),
    s("offline", "🔌", ["Offline brain", "If Claude is unreachable, chat and summaries fall back to a local Ollama model (no tools)."],
      ["Võrguühenduseta aju", "Kui Claude ei vasta, kasutavad vestlus ja kokkuvõtted kohalikku Ollama mudelit (ilma tööriistadeta)."], { setup: "ollama" }),
    s("warp", "⌕", ["Warp palette", "Ctrl+K jumps to any screen and searches goals, approvals, people and prospects. It only opens things, never approves."],
      ["Warp", "Ctrl+K viib suvalisele ekraanile ja otsib eesmärke, kinnitusi, inimesi ja kliente. See ainult avab, mitte kunagi ei kinnita."], { event: "palette" }),
    s("language", "🇪🇪", ["Eesti keel", "Profile has an English / Eesti switch. CORE answers in Estonian too."],
      ["Eesti keel", "Profiilis on English / Eesti lüliti. Ka CORE vastab siis eesti keeles."], { go: { panel: "profile" } }),
  ] },
  { id: "autonomy", icon: "🌙", title: { en: "Autonomy & calls", et: "Iseseisvus ja kõned" }, steps: [
    s("autonomy", "🎚", ["Autonomy levels", "Profile → Autonomy sets how much ORBIT may do alone, per area. Defaults are safe; Auto for email and publishing is opt-in."],
      ["Iseseisvuse tasemed", "Profiil → Iseseisvus määrab, kui palju ORBIT tohib igas valdkonnas ise teha. Vaikimisi on ohutu; e-posti ja avaldamise Auto lülitad sisse ise."],
      { go: { panel: "profile" }, setup: "vapid" }),
    s("night", "🌙", ["Night shift", "Say “tonight, research …” to queue work. ORBIT works while you're idle at night and learns which kinds of work you approve."],
      ["Öövahetus", "Ütle „tonight, research …“, et tööd järjekorda panna. ORBIT töötab öösel, kui sa arvutit ei kasuta, ja õpib, millist tööd sa kinnitad."], { go: { panel: "agents" } }),
    s("slept", "☀", ["While you slept", "In the morning one card shows the night's results with one-tap approve or reject. Nothing is sent, published or spent overnight."],
      ["Kuni sa magasid", "Hommikul näitab üks kaart öö tulemusi ühe puudutusega kinnitamiseks või tagasilükkamiseks. Öösel ei saadeta, avaldata ega kulutata midagi."], { go: { panel: null, morning: true } }),
    s("company", "🏢", ["Agent company", "AGENTS → Company: a CEO planner splits a goal into role steps run as a team, with a budget per role."],
      ["Agentide firma", "AGENDID → Company: juhi-planeerija jagab eesmärgi rollide sammudeks, mida meeskond teeb, igal rollil oma eelarve."], { go: { panel: "agents" } }),
    s("goal-autopilot", "🎯", ["Goal autopilot", "AGENTS → Goals: goals get weekly milestones and an evidence burn-up, and re-plan when you accept a change."],
      ["Eesmärkide autopiloot", "AGENDID → Goals: eesmärgid saavad iganädalased vahe-eesmärgid ja tõendite graafiku ning planeeritakse ümber, kui muudatuse kinnitad."], { go: { panel: "agents" } }),
    s("shorts-autopilot", "🎬", ["Shorts autopilot", "Overnight it picks the week's ideas, writes scripts and gets prices, then offers one morning button like “Approve 3 Shorts”."],
      ["Shortside autopiloot", "Öösel valib see nädala ideed, kirjutab stsenaariumid ja küsib hinnad, hommikul on üks nupp nagu „Kinnita 3 Shorti“."], { go: { panel: "studio", view: "clips" } }),
    s("calls", "📞", ["ORBIT calls you", "“ORBIT wants to talk”: it calls when approvals wait or a job fails, at most twice a day and never at night."],
      ["ORBIT helistab", "„ORBIT wants to talk“: see helistab, kui kinnitused ootavad või töö ebaõnnestub, kõige rohkem kaks korda päevas ja mitte kunagi öösel."], { setup: "twilio" }),
    s("calls-more", "🗣", ["Sunday and future-self calls", "Sunday evening brings a spoken weekly review with next week's top 3. Once a month ORBIT calls as your future self."],
      ["Pühapäeva- ja tulevikukõned", "Pühapäeva õhtul tuleb suuline nädala ülevaade järgmise nädala 3 tähtsaima asjaga. Kord kuus helistab ORBIT kui sinu tulevane mina."], { go: { panel: null, weekly: true } }),
    s("lessons", "💡", ["What I learned about you", "ORBIT notices lessons from your own decisions. Keep or Not true; kept ones shape CORE, the morning and the night shift."],
      ["Mida ma sinust õppisin", "ORBIT märkab sinu otsustest õppetunde. Keep või Not true; alles hoitud mõjutavad CORE'i, hommikut ja öövahetust."], { go: { panel: "profile" } }),
    s("rules", "📜", ["Standing rules", "Say “every Monday, …” or “when a client replies, …” and CORE proposes a rule. Confirm it in AGENTS → Rules; Run now tries it once, Pause stops it."],
      ["Püsireeglid", "Ütle „every Monday, …“ või „when a client replies, …“ ja CORE pakub välja reegli. Kinnita see: AGENDID → Rules; Run now proovib kohe, Pause peatab."], { go: { panel: "agents" } }),
    s("system", "🛰", ["System health", "The doctor's SYSTEM card shows services, failed jobs, free space, models and budgets. A problem that stays pushes you once."],
      ["Süsteemi tervis", "Doktori kaart SÜSTEEM näitab teenuseid, ebaõnnestunud töid, vaba ruumi, mudeleid ja eelarveid. Püsiv probleem saadab sulle ühe teavituse."], { go: { panel: null, doctor: true } }),
    s("patches", "🩹", ["Patch drafts", "Make ORBIT better → Draft patch: one Claude call writes a diff and a test, saved locally. It's never applied; Copy hands it to Claude Code."],
      ["Paranduste mustandid", "Make ORBIT better → Koosta parandus: üks Claude'i päring kirjutab muudatuse ja testi, mis salvestatakse kohalikult. Seda ei rakendata kunagi; Copy annab selle Claude Code'ile."], { go: { panel: null, doctor: true } }),
    s("health", "🩺", ["Self-healing", "A nightly health check reads the logs and lists problems with a Copy for builder button. It never changes code."],
      ["Isetervendamine", "Öine tervisekontroll loeb logisid ja näitab probleeme koos nupuga Copy for builder. See ei muuda kunagi koodi."], { go: { panel: null, doctor: true } }),
  ] },
  { id: "business", icon: "💼", title: { en: "Business", et: "Äri" }, steps: [
    s("scout", "🔭", ["Niche scout", "Every week: webshop ideas backed by 2+ web sources. Keep, Dismiss or Build shop (a local preview page, never deployed)."],
      ["Niššiskaut", "Iga nädal: veebipoe ideed, igaüks 2+ veebiallikaga. Keep, Dismiss või Build shop (kohalik eelvaade, mida kunagi ei avaldata)."], { go: { panel: "business" } }),
    s("negotiator", "🤝", ["Negotiator", "Paste a reply and ORBIT drafts a counter-offer that stays between your floor and ceiling. Approve emails it."],
      ["Läbirääkija", "Kleebi vastus ja ORBIT kirjutab vastupakkumise, mis jääb sinu miinimumi ja maksimumi vahele. Kinnitamine saadab selle e-postiga."],
      { go: { panel: "business" }, setup: "resend" }),
    s("contracts", "📝", ["Contracts", "Drafted from vetted templates with every change shown. Only you sign, and only you send."],
      ["Lepingud", "Koostatakse kontrollitud mallidest ja iga muudatus on näha. Allkirjastad ja saadad ainult sina."], { go: { panel: "business" } }),
    s("money", "🧾", ["Invoices and Money", "Invoices with VAT, an owed dashboard, reminder drafts for overdue ones and a monthly profit & loss view."],
      ["Arved ja raha", "Arved käibemaksuga, võlgade ülevaade, meeldetuletuste mustandid hilinenud arvetele ja igakuine kasumiaruanne."], { go: { panel: "business" } }),
    s("store", "🛍", ["Store launch package", "Shopify/WooCommerce CSV, Etsy text, margin-based prices, SEO, EU policy drafts and a 14-day plan."],
      ["Poe käivituspakett", "Shopify/WooCommerce CSV, Etsy tekst, marginist arvutatud hinnad, SEO, EL-i tingimuste mustandid ja 14 päeva plaan."], { go: { panel: "business" } }),
    s("rivals", "👀", ["Competitor watch and what-if", "A weekly read-only report on competitor pages, and a simulator that shows the chance of losing money."],
      ["Konkurentide jälgimine ja „mis siis, kui“", "Iganädalane ainult lugemiseks aruanne konkurentide lehtedest ja simulaator, mis näitab rahakaotuse tõenäosust."], { go: { panel: "business" } }),
    s("deals", "🏷", ["Deal hunter", "BUSINESS → Deals: keep a wishlist and ORBIT checks public shop pages, pushing you when a great deal shows up."],
      ["Pakkumiste kütt", "ÄRI → Deals: pea soovinimekirja ja ORBIT kontrollib avalikke poelehti ning teavitab, kui tuleb väga hea pakkumine."], { go: { panel: "business" } }),
    s("operator", "📋", ["Operator report", "ANALYTICS shows a weekly card of what ORBIT did on its own."],
      ["Operaatori aruanne", "ANALÜÜTIKA näitab iganädalast kaarti sellest, mida ORBIT ise tegi."], { go: { panel: "analytics" } }),
  ] },
  { id: "arch", icon: "📐", title: { en: "Architecture school", et: "Arhitektuurikool" }, steps: [
    s("plans", "🏠", ["Floor plans and structure", "A brief becomes 3–5 scored layouts; pick one and it becomes the model. The structure coach checks each floor (a teaching estimate)."],
      ["Korruseplaanid ja konstruktsioon", "Lähteülesandest saab 3–5 hinnatud plaanilahendust; vali üks ja sellest saab mudel. Konstruktsiooninõustaja kontrollib iga korrust (õppehinnang)."], { go: { panel: "arch" } }),
    s("materials", "🧱", ["Materials lab", "Compare cost, embodied carbon and U-values, scheme A against scheme B."],
      ["Materjalilabor", "Võrdle hinda, sisalduvat süsinikku ja U-arve, lahendus A lahenduse B vastu."], { go: { panel: "arch" } }),
    s("daylight", "🌤", ["Daylight and model city", "Sun hours per room, plus your plot with setbacks, coverage, neighbours and their shadows."],
      ["Päevavalgus ja mudellinn", "Päikesetunnid ruumide kaupa ning sinu krunt koos kujade, täisehitusprotsendi, naabrite ja nende varjudega."], { go: { panel: "arch" } }),
    s("time-machine", "⏳", ["Time machine", "Every change is saved. Scrub back through versions and Restore any of them."],
      ["Ajamasin", "Iga muudatus salvestatakse. Keri versioonides tagasi ja taasta ükskõik milline."], { go: { panel: "arch" } }),
    s("crit", "🎓", ["Studio crit", "One tutor critique per model version, from computed facts and a screenshot."],
      ["Stuudiokriitika", "Üks juhendaja kriitika iga mudeli versiooni kohta, arvutatud faktide ja ekraanipildi põhjal."], { go: { panel: "arch" } }),
    s("portfolio", "📁", ["Portfolio", "Your ARCH captures and picked work as an A4 PDF and a static web page."],
      ["Portfoolio", "Sinu ARCH-i pildid ja valitud tööd A4 PDF-ina ja staatilise veebilehena."], { go: { panel: "arch" } }),
    s("school", "🏫", ["School planner", "LIFE → School: add courses and deadlines; ORBIT plans study blocks backwards and warns about overloaded weeks."],
      ["Kooliplaneerija", "ELU → School: lisa kursused ja tähtajad; ORBIT planeerib õppeplokid tagurpidi ja hoiatab ülekoormatud nädalate eest."], { go: { panel: "life" } }),
  ] },
  { id: "galaxy", icon: "🌌", title: { en: "Galaxy & memory", et: "Galaktika ja mälu" }, steps: [
    s("chronicle", "🌊", ["Chronicle and episodes", "Your life and work as a river of days. Each night calls, decisions and wins become short episodes; journal text is never used."],
      ["Kroonika ja episoodid", "Sinu elu ja töö päevade jõena. Igal ööl saavad kõnedest, otsustest ja võitudest lühikesed episoodid; päeviku teksti ei kasutata kunagi."],
      { go: { panel: "memory" }, setup: "migrations" }),
    s("sources", "🔗", ["Where it came from", "Every memory and belief shows its source, with Why, Remember, Correct and Forget. Guesses stay suggested until you confirm."],
      ["Kust see tuli", "Igal mälukirjel ja uskumusel on allikas ning nupud Why, Remember, Correct ja Forget. Oletused jäävad soovitusteks, kuni sa kinnitad."],
      { go: { panel: "memory", beliefs: true }, setup: "migrations" }),
    s("people", "🪐", ["People and ideas", "A People ring shows the people in your life as moons; the knowledge graph shows concept clusters and bridges."],
      ["Inimesed ja ideed", "Inimeste ring näitab su elu inimesi kuudena; teadmiste graaf näitab mõistete kobaraid ja sildu."], { go: { panel: "memory" } }),
    s("cards", "🃏", ["Study cards", "Spaced repetition in MEMORY. Learn this on a memory drafts a card, and the morning brief offers 3 minutes of cards."],
      ["Õppekaardid", "Vahedega kordamine MÄLUS. Learn this mälukirjel teeb kaardi mustandi ja hommikuülevaade pakub 3 minutit kaarte."], { go: { panel: "memory", study: true } }),
    s("rewind", "⏪", ["Rewind", "Ask “what happened last March?” and get the facts for that time range."],
      ["Tagasikerimine", "Küsi „what happened last March?“ ja saad selle ajavahemiku faktid."], { go: { panel: "memory" } }),
    s("sky", "✨", ["A living galaxy", "The backdrop follows the real sky at your place, with comets, auroras, flares, a sunrise and spatial sound."],
      ["Elav galaktika", "Taust järgib päris taevast sinu asukohas: komeedid, virmalised, pursked, päikesetõus ja ruumiline heli."]),
    s("dilation", "🕰", ["Focus blocks", "25, 50 or 90 minutes on one goal: the galaxy slows and interruptions wait until the end."],
      ["Fookusplokid", "25, 50 või 90 minutit ühe eesmärgi kallal: galaktika aeglustub ja segajad ootavad lõpuni."], { go: { panel: "life", life: "focus" } }),
    s("capsule", "💾", ["Time capsule", "An encrypted nightly backup of ORBIT's local folder to a folder you pick, plus a restore wizard."],
      ["Ajakapsel", "Igaöine krüpteeritud varukoopia ORBITi kohalikust kaustast sinu valitud kausta ning taastamise abiline."],
      { go: { panel: "profile" }, setup: "capsule" }),
  ] },
  { id: "phone", icon: "📱", title: { en: "Phone", et: "Telefon" }, steps: [
    s("remote", "📱", ["Remote home screen", "The phone Remote now opens on a live galaxy header and a Needs-you stack. Pair it in Profile → Phone remote."],
      ["Puldi avaekraan", "Telefonipult avaneb nüüd elava galaktika päise ja „Ootab sind“ virnaga. Seo telefon: Profiil → Telefonipult."], { go: { panel: "profile" } }),
    s("push", "🔔", ["Push notifications", "Approvals waiting, Shorts going live, failed jobs. Only a short label, never the content; quiet at night."],
      ["Teavitused", "Ootel kinnitused, avalikuks läinud Shortid, ebaõnnestunud tööd. Ainult lühike silt, mitte kunagi sisu; öösel vaikne."], { setup: "vapid" }),
    s("car", "🚗", ["Car mode", "A big Talk button and a spoken brief. No approvals while driving."],
      ["Autorežiim", "Suur rääkimisnupp ja ette loetud ülevaade. Sõidu ajal kinnitusi ei tehta."]),
    s("shortcuts", "⌚", ["Siri and Watch", "Shortcuts for status, call me, stop, approve next and ask ORBIT, also from the Action button."],
      ["Siri ja Watch", "Otseteed olekule, helistamisele, peatamisele, järgmise kinnitamisele ja ORBITilt küsimisele, ka Action-nupust."],
      { go: { panel: "profile" }, setup: "shortcuts" }),
    s("place", "📍", ["Place and weather", "Opt in under Profile: the phone sends a rough location and the brief adds weather and place reminders."],
      ["Asukoht ja ilm", "Lülita sisse profiilis: telefon saadab umbkaudse asukoha ja ülevaade lisab ilma ning kohapõhised meeldetuletused."], { go: { panel: "profile" } }),
    s("screen2", "🖵", ["Second screen", "A tablet or spare monitor can show a read-only mission control at /screen."],
      ["Teine ekraan", "Tahvel või lisamonitor saab näidata ainult vaatamiseks missioonikeskust aadressil /screen."], { go: { panel: null, mission: true } }),
  ] },
];

export const STEPS: Step[] = CHAPTERS.flatMap((c) => c.steps);
export const chapterOf = (stepId: string) => CHAPTERS.find((c) => c.steps.some((x) => x.id === stepId)) ?? CHAPTERS[0];

/** at = the current step id; seen = steps already shown; closed = skipped for now (no auto-reopen); done = reached the end. */
export type Progress = { at: string; seen: string[]; closed: boolean; done: boolean };
export const START: Progress = { at: STEPS[0].id, seen: [], closed: false, done: false };

/** Stored JSON → progress (localStorage is untrusted: unknown ids are dropped, garbage = null as if never opened). */
export function parseProgress(raw: string | null): Progress | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<Progress>;
    if (!j || typeof j !== "object") return null;
    const ids = new Set(STEPS.map((x) => x.id));
    return {
      at: typeof j.at === "string" && ids.has(j.at) ? j.at : START.at,
      seen: Array.isArray(j.seen) ? [...new Set(j.seen.filter((x): x is string => typeof x === "string" && ids.has(x)))] : [],
      closed: j.closed === true, done: j.done === true,
    };
  } catch { return null; }
}

/** Only the first time after an update: never stored for this TOUR_KEY. */
export const shouldAutoOpen = (p: Progress | null) => p === null;

const index = (id: string) => Math.max(0, STEPS.findIndex((x) => x.id === id));
const see = (p: Progress, id: string): string[] => (p.seen.includes(id) ? p.seen : [...p.seen, id]);

/** Move to a step (marks it seen). */
export const goTo = (p: Progress, id: string): Progress => ({ ...p, at: STEPS[index(id)].id, seen: see(p, STEPS[index(id)].id), closed: false });
/** Next step; past the last one the tour is done and closes. */
export function next(p: Progress): Progress {
  const i = index(p.at);
  return i >= STEPS.length - 1 ? { ...p, seen: see(p, p.at), done: true, closed: true } : goTo(p, STEPS[i + 1].id);
}
export const back = (p: Progress): Progress => goTo(p, STEPS[Math.max(0, index(p.at) - 1)].id);
/** A chapter tab: its first unseen step, else its first step. */
export function openChapter(p: Progress, chapterId: string): Progress {
  const c = CHAPTERS.find((x) => x.id === chapterId) ?? CHAPTERS[0];
  return goTo(p, (c.steps.find((x) => !p.seen.includes(x.id)) ?? c.steps[0]).id);
}
export const skip = (p: Progress): Progress => ({ ...p, seen: see(p, p.at), closed: true });
/** Reopen from the palette: where he left off, or from the start when he finished. */
export const resume = (p: Progress | null): Progress => (!p ? goTo(START, START.at) : p.done ? { ...goTo(START, START.at), seen: p.seen } : goTo(p, p.at));
export const chapterDone = (p: Progress, c: Chapter) => c.steps.every((x) => p.seen.includes(x.id));
export const position = (p: Progress) => ({ n: index(p.at) + 1, total: STEPS.length });
