// Tiny i18n: English is the source and the fallback, Estonian covers the most-seen surfaces (HUD, ⋯ menu, planets, morning
// cards, approvals, Profile titles, the phone Remote). Hook + language switch: components/i18n.tsx. No dependency.
import { PLANETS, type PlanetId } from "./planets.ts";

export type Lang = "en" | "et";
export const LANG_KEY = "orbit.lang";
export const parseLang = (v: unknown): Lang => (v === "et" ? "et" : "en");

const BASE = {
  "common.close": "Close", "common.open": "Open", "common.approve": "Approve", "common.reject": "Reject",
  "common.approved": "Approved", "common.rejected": "Rejected", "common.copy": "Copy", "common.on": "on", "common.off": "off",
  "common.failed": "Couldn't do that",

  "lang.title": "Language", "lang.hint": "Menus, cards and buttons. CORE answers in the same language.",

  "hud.home": "Orbital home", "hud.tagline": "YOUR MIND HAS A UNIVERSE",
  "hud.live": "LIVE", "hud.offline": "OFFLINE", "hud.connecting": "CONNECTING",
  "hud.liveTitle": "Realtime link to the backend that animates the galaxy",
  "hud.search": "Warp: jump, search, act (Ctrl+K)", "hud.searchTitle": "Warp: jump anywhere, search everything, quick actions (Ctrl+K)",
  "hud.index": "Index", "hud.galaxy": "Galaxy",
  "hud.viewTitle": "Switch between the galaxy and the workspace index. Your choice is remembered.",
  "hud.more": "More options", "hud.moreTitle": "More: profile, 3D quality, shortcuts, sign out",
  "hud.profile": "Your profile", "hud.closePanel": "Close panel", "hud.closeEsc": "Close (Esc)",
  "menu.search": "Warp: jump and search", "menu.profile": "Profile", "menu.quality": "Quality", "menu.qualityGroup": "3D quality",
  "quality.auto": "Auto", "quality.high": "High", "quality.low": "Low",
  "quality.auto.title": "Lowers detail when the galaxy stutters, raises it when there's headroom",
  "quality.high.title": "Always full detail and glow", "quality.low.title": "Fewest stars, no glow: smoothest on slow GPUs",
  "menu.timeTravel": "Time travel", "menu.mission": "Mission control", "menu.shortcuts": "Keyboard shortcuts",
  "menu.sounds": "UI sounds: {state}", "menu.signOut": "Sign out",
  "explore.open": "Explore", "explore.label": "Explore workspaces", "explore.heading": "Your universe",
  "explore.close": "Close workspace navigation", "explore.core": "Start with a question.",
  "overview.core": "Your central AI. Ask anything.",
  "overview.memories.one": "{n} memory", "overview.memories.other": "{n} memories",

  "stop.aria": "Stop all: pause every agent, automation and background job", "stop.aria.on": "Stop-all is on. Resume ORBIT",
  "stop.title": "Stop-all: cancel running agents and pause every automation and background job (asks first)",
  "stop.title.on": "Stop-all is on: click to resume",
  "stop.confirm": "Stop everything?\n\nRunning agent tasks, agent teams and goal steps are cancelled, and no automation, scout, autopilot, briefing or suggestion starts until you press Resume. Clip renders already running finish. CORE chat keeps answering.",
  "stop.paused": "Paused", "stop.pausedOn": "Stop-all on", "stop.resume": "Resume",
  "stop.resumeTitle": "Turn Stop-all off: queued work starts again", "stop.failed": "Couldn't switch Stop-all",

  "greet.morning": "Good morning", "greet.afternoon": "Good afternoon", "greet.evening": "Good evening",
  "morning.welcome": "WELCOME BACK", "morning.aria": "Morning briefing", "morning.since": "Since you left",
  "morning.dismiss": "Dismiss morning briefing", "morning.dismissRecap": "Dismiss recap",
  "morning.hoursAgo": "{n} h ago", "morning.daysAgo.one": "{n} day ago", "morning.daysAgo.other": "{n} days ago",
  "since.tasks.one": "{n} agent task finished", "since.tasks.other": "{n} agent tasks finished", "since.failed": " · {n} failed",
  "since.live.one": "{n} Short went live", "since.live.other": "{n} Shorts went live",
  "since.clips.one": "{n} new clip in REVIEW", "since.clips.other": "{n} new clips in REVIEW",
  "since.approvals.one": "{n} approval waiting for you", "since.approvals.other": "{n} approvals waiting for you",
  "since.notes.one": "{n} new notification", "since.notes.other": "{n} new notifications",
  "morning.loading": "Gathering your briefing…", "morning.ytPaused": "YouTube downloads paused until {t}", "morning.more": "More",
  "morning.tile.clips": "clips to review", "morning.tile.live": "live today", "morning.tile.proposals": "proposals", "morning.tile.habits": "habits",
  "morning.best": "YESTERDAY'S BEST", "morning.views": " views", "morning.mission": "Today's mission", "morning.missionDone": "{done}/{total} done",
  "morning.failed.one": "{n} agent task failed overnight", "morning.failed.other": "{n} agent tasks failed overnight",
  "morning.connectCal": "Connect Google Calendar", "morning.readAloud": "Read it aloud each morning",
  "night.slept": "While you slept", "night.working": "working now…", "night.okStep": "OK step", "night.draft": "Read the draft (not sent)",

  "brief.aria": "Morning brief", "brief.mute": "Mute", "brief.muteAria": "Mute the brief", "brief.skip": "Skip", "brief.skipAria": "Skip the morning brief",
  "brief.loading": "Pulling your morning together…", "brief.ready": "Morning brief ready.", "brief.empty": "Nothing needs you this morning. Enjoy it.",
  "brief.snooze": "Snooze", "brief.snoozeAria": "Snooze {title} until tomorrow", "brief.snoozed": "Snoozed till tomorrow",
  "brief.life": "Say calendar titles and reminders aloud (from tomorrow)",

  "approval.waiting": "{who} is waiting for your approval", "approval.later": "{who} will ask for approval when it finishes",
  "approval.preview": "preview", "approval.what": "what it will do", "approval.working": "Still working… Approve and Reject appear when it's done.",

  "profile.intro": "CORE reads this. Only what you write here is used; ORBIT never turns guesses into profile facts.",
  "profile.name": "Name", "profile.interests": "Interests", "profile.projects": "Current projects", "profile.goals": "Goals",
  "profile.news_topics": "Preferred news topics", "profile.research_priorities": "Research priorities", "profile.comma": "(comma separated)",
  "profile.talk": "How CORE should talk to you", "profile.save": "Save profile", "profile.saved": "Saved.",
  "profile.password": "Sign-in password", "profile.autonomy": "Autonomy", "profile.phone": "Phone remote",
  "profile.persona": "ORBIT's character", "profile.playbook": "How CORE has adapted", "profile.lessons": "What I learned about you",

  "remote.title": "ORBITAL REMOTE", "remote.connecting": "Connecting…", "remote.unreachable": "Can't reach ORBIT: is the PC on and Tailscale connected?",
  "remote.network": "Network error", "remote.done": "Done",
  "remote.stop": "Stop-all", "remote.stopOn": "ON: ORBIT is paused. Resume it from the PC.", "remote.stopOff": "Off: ORBIT is running.",
  "remote.stopButton": "Stop all", "remote.stopConfirm": "Stop all: pause agents, automations and goals now? Resuming is done on the PC.",
  "remote.stopped": "Stop-all is on: ORBIT paused",
  "remote.waiting": "Waiting for you ({n})", "remote.nothing": "Nothing to approve.", "remote.noPreview": "No preview: open on PC to review.",
  "remote.thumbAlt": "Thumbnail of {title}", "remote.quote": "Quote:", "remote.plan": "Plan:", "remote.to": "To:",
  "remote.credits.one": "{n} credit", "remote.credits.other": "{n} credits",
  "remote.approveCredits.one": "Approve {n} credit", "remote.approveCredits.other": "Approve {n} credits", "remote.approveSend": "Approve & send",
  "remote.confirmSpend": "Spend {n} Higgsfield credits on “{title}”?", "remote.confirmSend": "Email this exact message to {to}?",
  "remote.confirmNego": "Approve this message to “{title}”? You copy and send it yourself.",
  "remote.confirmApprove": "Approve “{title}”?", "remote.confirmReject": "Reject “{title}”? Its files are deleted.",
  "remote.queue": "Studio queue", "remote.queueLine": "{ready} to review · {approved} approved, not yet published",
  "remote.uploading": " · uploading now", "remote.story": " · AI story generating", "remote.noJobs": "No jobs running.",
  "remote.ask": "Ask CORE", "remote.askPlaceholder": "Ask anything…", "remote.askAria": "Question for CORE", "remote.thinking": "Thinking…",
  "remote.askButton": "Ask", "remote.askStop": "Stop", "remote.coreFailed": "CORE failed", "remote.failed": "Failed",
  "remote.notify": "Notifications", "remote.notifyIos": "On iPhone (iOS 16.4+), open Remote from the Home Screen to turn notifications on.",
  "remote.checking": "Checking…",
  "remote.notifyAbout": "Approvals waiting, Shorts going live, failed jobs and Stop-all. Only a short label, never the content. Quiet 23:00–08:00 except failures.",
  "remote.notifyOff": "Turn off on this phone", "remote.notifyOn": "Enable notifications",
  "remote.paused": "ORBIT is paused", "remote.quiet": "All quiet", "remote.need.one": "{n} thing needs you", "remote.need.other": "{n} things need you",
  "remote.kind.spend": "Spend", "remote.kind.send": "Email", "remote.kind.nego": "Reply", "remote.kind.invoice": "Invoice", "remote.kind.clip": "Clip",
  "remote.later": "Review later",
  "remote.night": "Night report", "remote.nightLine": "{done} done · {approvals} to approve · {failed} failed", "remote.nightRunning": " · still working",
  "remote.nightTag.done": "Done", "remote.nightTag.approval": "To approve", "remote.nightTag.failed": "Failed",
  "remote.owes.one": "{buyer} owes {amount} · {n} day overdue", "remote.owes.other": "{buyer} owes {amount} · {n} days overdue",

  "habit.time": "Habit time", "habit.toastReason": "Habit time: {name}", "habit.nudgeAt": " · nudge ~{t}",
  "habit.when": "When: evening 19–22, after lunch, on Mondays", "habit.whenAria": "When to nudge {name}", "habit.howAria": "How to nudge {name}",
  "habit.off": "No nudge", "habit.toast": "In ORBIT", "habit.push": "Phone", "habit.save": "Save",
  "push.habit.title": "Habit time", "push.habit.body": "One of your habits is up. Tap Done when it's done.",

  "tour.title": "WHAT'S NEW", "tour.step": "{n} of {total}", "tour.chapters": "Tour chapters", "tour.showMe": "Show me",
  "tour.next": "Next", "tour.back": "Back", "tour.finish": "Finish", "tour.skip": "Skip for now",
  "tour.skipAria": "Skip the tour for now. Resume it from Ctrl+K: What's new tour", "tour.setup": "Set this up:", "tour.ready": "What's new tour is open.", "tour.setupLink": "Setup steps",
} as const;

type PlanetKey = `planet.${PlanetId}` | `planet.${PlanetId}.blurb`;
export type Key = keyof typeof BASE | PlanetKey;

/** English: the source of every key. Planet names and blurbs come straight from planets.ts. */
export const EN = { ...BASE, ...Object.fromEntries(PLANETS.flatMap((p) => [[`planet.${p.id}`, p.name], [`planet.${p.id}.blurb`, p.blurb]])) } as Record<Key, string>;

/* Estonian glossary (keep terms the same everywhere):
 *   approve = kinnita · approval = kinnitus · reject = lükka tagasi · stop all / stop-all = peata kõik · resume = jätka
 *   snooze = lükka homsesse · skip = jäta vahele · mute = vaigista · open = ava · close = sulge
 *   memory (a saved item) = mälukirje · agent task = agendi ülesanne · automation = automatiseering · goal = eesmärk
 *   brief/briefing = ülevaade · morning brief = hommikuülevaade · clip = klipp · Short = Short · credit = krediit
 *   notification = teavitus · nudge (habit) = meeldetuletus · habit = harjumus · profile = profiil · CORE, ORBIT, Orbital, Pulse, Higgsfield = names, never translated
 * Counts: after a number other than 1 Estonian takes the partitive singular ("3 agenti"), so .one/.other is enough. */
export const ET: Partial<Record<Key, string>> = {
  "common.close": "Sulge", "common.open": "Ava", "common.approve": "Kinnita", "common.reject": "Lükka tagasi",
  "common.approved": "Kinnitatud", "common.rejected": "Tagasi lükatud", "common.copy": "Kopeeri", "common.on": "sees", "common.off": "väljas",
  "common.failed": "See ei õnnestunud",

  "lang.title": "Keel", "lang.hint": "Menüüd, kaardid ja nupud. CORE vastab samas keeles.",

  "hud.home": "Orbitali avaleht", "hud.tagline": "SINU MÕTTEL ON OMA UNIVERSUM",
  "hud.live": "OTSE", "hud.offline": "ÜHENDUSETA", "hud.connecting": "ÜHENDAN",
  "hud.liveTitle": "Reaalajas ühendus serveriga, mis galaktikat liigutab",
  "hud.search": "Warp: hüppa, otsi, tegutse (Ctrl+K)", "hud.searchTitle": "Warp: hüppa kuhu iganes, otsi kõikjalt, kiirtoimingud (Ctrl+K)",
  "hud.index": "Loend", "hud.galaxy": "Galaktika",
  "hud.viewTitle": "Vaheta galaktika ja tööruumide loendi vahel. Valik jääb meelde.",
  "hud.more": "Rohkem valikuid", "hud.moreTitle": "Veel: profiil, 3D kvaliteet, kiirklahvid, väljalogimine",
  "hud.profile": "Sinu profiil", "hud.closePanel": "Sulge paneel", "hud.closeEsc": "Sulge (Esc)",
  "menu.search": "Warp: hüppa ja otsi", "menu.profile": "Profiil", "menu.quality": "Kvaliteet", "menu.qualityGroup": "3D kvaliteet",
  "quality.auto": "Auto", "quality.high": "Kõrge", "quality.low": "Madal",
  "quality.auto.title": "Vähendab detaile, kui galaktika hakib, ja lisab, kui jõudlust jagub",
  "quality.high.title": "Alati kõik detailid ja kuma", "quality.low.title": "Kõige vähem tähti, kuma pole: aeglasel videokaardil kõige sujuvam",
  "menu.timeTravel": "Ajarännak", "menu.mission": "Missioonikeskus", "menu.shortcuts": "Kiirklahvid",
  "menu.sounds": "Liidese helid: {state}", "menu.signOut": "Logi välja",
  "explore.open": "Avasta", "explore.label": "Avasta tööruume", "explore.heading": "Sinu universum",
  "explore.close": "Sulge tööruumide valik", "explore.core": "Alusta küsimusega.",
  "overview.core": "Sinu keskne tehisaru. Küsi mida tahes.",
  "overview.memories.one": "{n} mälukirje", "overview.memories.other": "{n} mälukirjet",

  "planet.memory": "MÄLU", "planet.memory.blurb": "Sinu teine aju: märkmed, ideed, lingid ja otsused.",
  "planet.intelligence": "LUURE", "planet.intelligence.blurb": "Värsked uudised ja Pulse'i ülevaated, igal lool allikas.",
  "planet.creation": "MÄNGUARENDUS", "planet.creation.blurb": "Sinu mängud: kunst, vigade nimekiri, testmängud ja Planet Forge.",
  "planet.operations": "TÖÖD", "planet.operations.blurb": "Agentide ülesanded, projektid ja sinu automatiseeringud.",
  "planet.agents": "AGENDID", "planet.agents.blurb": "Sinu tehisaru meeskond: Nova, Atlas, Pulse, Echo, Forge ja teised.",
  "planet.life": "ELU", "planet.life.blurb": "Harjumused ja nende jadad, meeldetuletused, fookustaimer ja päevik.",
  "planet.vault": "SEIF", "planet.vault.blurb": "Sinu privaatne failihoidla: lohista failid sisse, vaata, otsi seest ja küsi CORE'ilt.",
  "planet.analytics": "ANALÜÜTIKA", "planet.analytics.blurb": "Sinu tegelik tegevus ja tehisaru kasutus.",
  "planet.studio": "STUUDIO", "planet.studio.blurb": "Sinu YouTube'i kanal: videod on kuud, ja kui mõni lendu läheb, saab temast komeet.",
  "planet.theater": "TEATER", "planet.theater.blurb": "Leia häälega looja uusimad videod ja vaata neid suurelt ekraanilt.",
  "planet.markets": "TURUD", "planet.markets.blurb": "Jälgimisnimekiri, portfell, hoiatused ja paberkauplemine. Ainult simulatsioon, mitte investeerimisnõu.",
  "planet.business": "ÄRI", "planet.business.blurb": "Sinu kliendid: kellega ühendust võtta, pilootprojektid, maksvad kliendid ja CORE'i kirjutatud esimesed sõnumid.",
  "planet.arch": "ARHITEKTUUR", "planet.arch.blurb": "Õpi arhitektuuri: ehita rääkides 3D-s, näe koguseid, hinda ja hulgiostu nippe.",

  "stop.aria": "Peata kõik: peatab iga agendi, automatiseeringu ja taustatöö", "stop.aria.on": "Peata kõik on sees. Jätka ORBITi tööd",
  "stop.title": "Peata kõik: tühistab töötavad agendid ja peatab automatiseeringud ning taustatööd (küsib enne üle)",
  "stop.title.on": "Peata kõik on sees: klõpsa, et jätkata",
  "stop.confirm": "Kas peatada kõik?\n\nTöötavad agentide ülesanded, agentide tiimid ja eesmärkide sammud tühistatakse ning ükski automatiseering, skaut, autopiloot, ülevaade ega soovitus ei käivitu enne, kui vajutad „Jätka“. Juba käivad klippide renderdused tehakse lõpuni. CORE vastab vestluses edasi.",
  "stop.paused": "Peatatud", "stop.pausedOn": "peata kõik on sees", "stop.resume": "Jätka",
  "stop.resumeTitle": "Lülita „Peata kõik“ välja: ootel tööd lähevad uuesti käima", "stop.failed": "„Peata kõik“ lülitamine ei õnnestunud",

  "greet.morning": "Tere hommikust", "greet.afternoon": "Tere päevast", "greet.evening": "Tere õhtust",
  "morning.welcome": "TERE TULEMAST TAGASI", "morning.aria": "Hommikuülevaade", "morning.since": "Sinu äraolekul",
  "morning.dismiss": "Sulge hommikuülevaade", "morning.dismissRecap": "Sulge kokkuvõte",
  "morning.hoursAgo": "{n} h tagasi", "morning.daysAgo.one": "{n} päev tagasi", "morning.daysAgo.other": "{n} päeva tagasi",
  "since.tasks.one": "{n} agendi ülesanne sai valmis", "since.tasks.other": "{n} agendi ülesannet sai valmis", "since.failed": " · {n} ebaõnnestus",
  "since.live.one": "{n} Short läks avalikuks", "since.live.other": "{n} Shorti läks avalikuks",
  "since.clips.one": "{n} uus klipp ootab ülevaatust", "since.clips.other": "{n} uut klippi ootab ülevaatust",
  "since.approvals.one": "{n} kinnitus ootab sind", "since.approvals.other": "{n} kinnitust ootab sind",
  "since.notes.one": "{n} uus teavitus", "since.notes.other": "{n} uut teavitust",
  "morning.loading": "Panen ülevaadet kokku…", "morning.ytPaused": "YouTube'i allalaadimised on peatatud kuni {t}", "morning.more": "Veel",
  "morning.tile.clips": "klippi üle vaadata", "morning.tile.live": "täna avalikud", "morning.tile.proposals": "ettepanekud", "morning.tile.habits": "harjumused",
  "morning.best": "EILNE PARIM", "morning.views": " vaatamist", "morning.mission": "Tänane missioon", "morning.missionDone": "{done}/{total} tehtud",
  "morning.failed.one": "{n} agendi ülesanne ebaõnnestus öösel", "morning.failed.other": "{n} agendi ülesannet ebaõnnestus öösel",
  "morning.connectCal": "Ühenda Google'i kalender", "morning.readAloud": "Loe see igal hommikul ette",
  "night.slept": "Kuni sa magasid", "night.working": "töötab praegu…", "night.okStep": "Kinnita samm", "night.draft": "Loe mustandit (pole saadetud)",

  "brief.aria": "Hommikuülevaade", "brief.mute": "Vaigista", "brief.muteAria": "Vaigista ülevaade", "brief.skip": "Jäta vahele", "brief.skipAria": "Jäta hommikuülevaade vahele",
  "brief.loading": "Panen su hommikut kokku…", "brief.ready": "Hommikune ülevaade on valmis.", "brief.empty": "Täna hommikul pole sind kuskil vaja. Naudi seda.",
  "brief.snooze": "Homseks", "brief.snoozeAria": "Lükka „{title}“ homsesse", "brief.snoozed": "Lükatud homsesse",
  "brief.life": "Loe kalendrisündmused ja meeldetuletused ette (alates homsest)",

  "approval.waiting": "{who} ootab sinu kinnitust", "approval.later": "{who} küsib lõpetades sinu kinnitust",
  "approval.preview": "eelvaade", "approval.what": "mida see teeb", "approval.working": "Töötab veel… „Kinnita“ ja „Lükka tagasi“ ilmuvad, kui töö on valmis.",

  "profile.intro": "CORE loeb seda. Kasutatakse ainult seda, mida siia ise kirjutad; ORBIT ei tee oletustest kunagi profiili fakte.",
  "profile.name": "Nimi", "profile.interests": "Huvid", "profile.projects": "Praegused projektid", "profile.goals": "Eesmärgid",
  "profile.news_topics": "Eelistatud uudisteemad", "profile.research_priorities": "Uurimise prioriteedid", "profile.comma": "(komadega eraldatud)",
  "profile.talk": "Kuidas CORE peaks sinuga rääkima", "profile.save": "Salvesta profiil", "profile.saved": "Salvestatud.",
  "profile.password": "Sisselogimise parool", "profile.autonomy": "Iseseisvus", "profile.phone": "Telefonipult",
  "profile.persona": "ORBITi iseloom", "profile.playbook": "Kuidas CORE on kohanenud", "profile.lessons": "Mida ma sinust õppisin",

  "remote.title": "ORBITALI PULT", "remote.connecting": "Ühendan…", "remote.unreachable": "ORBIT ei vasta: kas arvuti on sees ja Tailscale ühendatud?",
  "remote.network": "Võrguviga", "remote.done": "Tehtud",
  "remote.stop": "Peata kõik", "remote.stopOn": "SEES: ORBIT on peatatud. Jätka arvutist.", "remote.stopOff": "VÄLJAS: ORBIT töötab.",
  "remote.stopButton": "Peata kõik", "remote.stopConfirm": "Peata kõik: kas peatada agendid, automatiseeringud ja eesmärgid kohe? Jätkata saab ainult arvutist.",
  "remote.stopped": "Peata kõik on sees: ORBIT on peatatud",
  "remote.waiting": "Ootab sind ({n})", "remote.nothing": "Pole midagi kinnitada.", "remote.noPreview": "Eelvaadet pole: vaata see arvutis üle.",
  "remote.thumbAlt": "Pisipilt: {title}", "remote.quote": "Hind:", "remote.plan": "Plaan:", "remote.to": "Saaja:",
  "remote.credits.one": "{n} krediit", "remote.credits.other": "{n} krediiti",
  "remote.approveCredits.one": "Kinnita {n} krediit", "remote.approveCredits.other": "Kinnita {n} krediiti", "remote.approveSend": "Kinnita ja saada",
  "remote.confirmSpend": "Kas kulutada {n} Higgsfieldi krediiti: „{title}“?", "remote.confirmSend": "Kas saata täpselt see sõnum aadressile {to}?",
  "remote.confirmNego": "Kas kinnitada see sõnum: „{title}“? Kopeerid ja saadad selle ise.",
  "remote.confirmApprove": "Kas kinnitada „{title}“?", "remote.confirmReject": "Kas lükata „{title}“ tagasi? Selle failid kustutatakse.",
  "remote.queue": "Stuudio järjekord", "remote.queueLine": "{ready} ootab ülevaatust · {approved} kinnitatud, veel avaldamata",
  "remote.uploading": " · laadin praegu üles", "remote.story": " · tehisaru kirjutab lugu", "remote.noJobs": "Ühtegi tööd ei käi.",
  "remote.ask": "Küsi CORE'ilt", "remote.askPlaceholder": "Küsi mida tahes…", "remote.askAria": "Küsimus CORE'ile", "remote.thinking": "Mõtlen…",
  "remote.askButton": "Küsi", "remote.askStop": "Peata", "remote.coreFailed": "CORE ei saanud vastata", "remote.failed": "Ei õnnestunud",
  "remote.notify": "Teavitused", "remote.notifyIos": "iPhone'is (iOS 16.4+) ava Remote avaekraanilt, et teavitused sisse lülitada.",
  "remote.checking": "Kontrollin…",
  "remote.notifyAbout": "Ootel kinnitused, avalikuks läinud Shortid, ebaõnnestunud tööd ja „Peata kõik“. Ainult lühike silt, mitte kunagi sisu. Kell 23–08 vaikne, välja arvatud vead.",
  "remote.notifyOff": "Lülita selles telefonis välja", "remote.notifyOn": "Lülita teavitused sisse",
  "remote.paused": "ORBIT on peatatud", "remote.quiet": "Kõik on rahulik", "remote.need.one": "{n} asi ootab sind", "remote.need.other": "{n} asja ootab sind",
  "remote.kind.spend": "Kulu", "remote.kind.send": "E-kiri", "remote.kind.nego": "Vastus", "remote.kind.invoice": "Arve", "remote.kind.clip": "Klipp",
  "remote.later": "Vaata hiljem",
  "remote.night": "Öine aruanne", "remote.nightLine": "{done} tehtud · {approvals} kinnitada · {failed} ebaõnnestus", "remote.nightRunning": " · töötab veel",
  "remote.nightTag.done": "Tehtud", "remote.nightTag.approval": "Kinnitada", "remote.nightTag.failed": "Ebaõnnestus",
  "remote.owes.one": "{buyer} võlgneb {amount} · {n} päev üle tähtaja", "remote.owes.other": "{buyer} võlgneb {amount} · {n} päeva üle tähtaja",

  "habit.time": "Harjumuse aeg", "habit.toastReason": "Harjumuse aeg: {name}", "habit.nudgeAt": " · meeldetuletus ~{t}",
  "habit.when": "Millal (kellaaeg või inglise keeles): 19–22, after lunch, on Mondays", "habit.whenAria": "Millal meelde tuletada: {name}", "habit.howAria": "Kuidas meelde tuletada: {name}",
  "habit.off": "Ära tuleta meelde", "habit.toast": "ORBITis", "habit.push": "Telefonis", "habit.save": "Salvesta",
  "push.habit.title": "Harjumuse aeg", "push.habit.body": "Üks su harjumustest on käes. Vajuta „Tehtud“, kui see on tehtud.",

  "tour.title": "UUDISED", "tour.step": "{n}/{total}", "tour.chapters": "Tuuri peatükid", "tour.showMe": "Näita",
  "tour.next": "Edasi", "tour.back": "Tagasi", "tour.finish": "Valmis", "tour.skip": "Jäta praegu vahele",
  "tour.skipAria": "Jäta tuur praegu vahele. Jätka seda Ctrl+K kaudu: What's new tour", "tour.setup": "Seadista:", "tour.ready": "Uudiste tuur on avatud.", "tour.setupLink": "Seadistuse sammud",
};

type Vars = Record<string, string | number>;
const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

/** Lookup with fallback: Estonian when chosen and present, else English, else the key itself (never blank). */
export function translate(lang: Lang, key: Key, vars?: Vars): string {
  return fill((lang === "et" && ET[key]) || EN[key] || key, vars);
}

type PluralBase = { [K in Key]: K extends `${infer B}.one` ? B : never }[Key];
/** Count + noun: `.one` only for exactly 1 (also in Estonian: 21 takes the partitive, "21 agenti"), `.other` otherwise; {n} = n. */
export function plural(lang: Lang, base: PluralBase, n: number, vars?: Vars): string {
  return translate(lang, `${base}.${Math.abs(n) === 1 ? "one" : "other"}` as Key, { ...vars, n });
}

/** Greeting for a local hour, same thresholds as morning-pure greeting(). */
export const greetKey = (hour: number): Key => (hour < 12 ? "greet.morning" : hour < 18 ? "greet.afternoon" : "greet.evening");

/** The one line CORE's prompt gains when Estonian is on. It rides in each turn's request tail, not the system prompt,
 *  so the system prompt stays identical and the pre-warmed spare CLIs (keyed by system prompt) still match. */
export const CORE_LANG_RULE: Record<Lang, string> = {
  en: "",
  et: "LANGUAGE: the user reads ORBIT in Estonian. Write your answer in natural, fluent Estonian (eesti keeles) unless they write in another language or ask for one. Keep JSON keys, tool names, tool inputs and code in English.\n\n",
};
