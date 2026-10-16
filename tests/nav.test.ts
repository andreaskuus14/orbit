import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNavCommand, validateNav, navLabel, navReply, LOCAL_COUNTRY } from "../src/lib/nav-pure.ts";

const yes: [string, object][] = [
  ["go to local news", { panel: "intelligence", country: LOCAL_COUNTRY }],
  ["Show me my local news, please.", { panel: "intelligence", country: "Estonia" }],
  ["open intelligence", { panel: "intelligence" }],
  ["Hey Orbit, open the news", { panel: "intelligence" }],
  ["show me Estonia", { panel: "intelligence", country: "Estonia" }],
  ["show Estonia", { panel: "intelligence", country: "Estonia" }],
  ["show me news from Germany", { panel: "intelligence", country: "Germany" }],
  ["go to news in Germany", { panel: "intelligence", country: "Germany" }],
  ["show me German news", { panel: "intelligence", country: "Germany" }],
  ["open Europe news", { panel: "intelligence", region: "Europe" }],
  ["fly to the Middle East", { panel: "intelligence", region: "Middle East" }],
  ["show me news from the USA", { panel: "intelligence", country: "United States of America" }],
  ["take me to America", { panel: "intelligence", country: "United States of America" }],
  ["show me the U.S.", { panel: "intelligence", country: "United States of America" }],
  ["fly to the UK", { panel: "intelligence", country: "United Kingdom" }],
  ["show me Britain", { panel: "intelligence", country: "United Kingdom" }],
  ["take me to the studio", { panel: "studio" }],
  ["open youtube", { panel: "studio" }],
  ["open game dev", { panel: "creation" }],
  ["can you take me to the game lab", { panel: "creation" }],
  ["show my stats", { panel: "studio", view: "stats" }],
  ["show me my analytics", { panel: "studio", view: "stats" }],
  ["open analytics", { panel: "analytics" }],
  ["open the clip factory", { panel: "studio", view: "clips" }],
  ["go back to the galaxy", { panel: null }],
  ["go back", { panel: null }],
  ["take me home", { panel: null }],
  ["Orbit, open my notes", { panel: "memory" }],
  ["switch to agents", { panel: "agents" }],
  ["open the agents station", { panel: "agents" }],
  ["go to my agents", { panel: "agents" }],
  ["take me to the station", { panel: "agents" }],
  ["bring up my tasks", { panel: "operations" }],
  ["navigate to the vault", { panel: "vault" }],
  ["open life", { panel: "life" }],
  ["show my habits", { panel: "life", life: "habits" }],
  ["start focus", { panel: "life", life: "focus", start: true }],
  ["start a focus timer", { panel: "life", life: "focus", start: true }],
  ["Start focus mode.", { panel: "life", life: "focus", start: true }],
  ["Orbit, start pomodoro please", { panel: "life", life: "focus", start: true }],
  ["focus timer", { panel: "life", life: "focus" }],
  ["open the focus timer", { panel: "life", life: "focus" }],
  ["open my journal", { panel: "life", life: "journal" }],
  ["journal", { panel: "life", life: "journal" }],
  ["show my reminders", { panel: "life", life: "reminders" }],
  ["open my files", { panel: "vault" }],
  ["open core", { panel: "core" }],
  ["open my profile", { panel: "profile" }],
  ["please go to the memory planet now", { panel: "memory" }],
  ["show my channel", { panel: "studio", view: "none" }],
  ["go straight to the clips", { panel: "studio", view: "clips" }],
  ["review clips", { panel: "studio", view: "review" }],
  ["Morning review", { panel: "studio", view: "review" }],
  ["open review", { panel: "studio", view: "review" }],
  ["Orbit, review my clips please", { panel: "studio", view: "review" }],
  ["show me the morning review", { panel: "studio", view: "review" }],
  ["zoom in on Germany", { panel: "intelligence", country: "Germany" }],
  // news search (no context needed: the verb makes it unambiguous)
  ["search the news for AI chips", { panel: "intelligence", search: "ai chips" }],
  ["Search news about oil prices please", { panel: "intelligence", search: "oil prices" }],
  ["search news about the election", { panel: "intelligence", search: "the election" }],
  ["search the news for SpaceX", { panel: "intelligence", search: "spacex" }],
  ["find news about Tesla", { panel: "intelligence", search: "tesla" }],
  ["show me news about AI", { panel: "intelligence", search: "ai" }],
  ["show me news about the White House", { panel: "intelligence", search: "the white house" }],
  ["Orbit, look up bitcoin news", { panel: "intelligence", search: "bitcoin" }],
  ["search for climate news", { panel: "intelligence", search: "climate" }],
  ["search for Germany", { panel: "intelligence", country: "Germany" }],
  ["search news in Japan", { panel: "intelligence", country: "Japan" }],
  ["find news about France", { panel: "intelligence", country: "France" }],
  ["search for local news", { panel: "intelligence", country: "Estonia" }],
  ["clear search", { panel: "intelligence", search: "" }],
  ["back to the world map", { panel: "intelligence", search: "" }],
  ["show the whole world", { panel: "intelligence", search: "" }],
];

test("parseNavCommand understands clear navigation commands", () => {
  for (const [text, want] of yes) assert.deepEqual(parseNavCommand(text), want, text);
});

test("parseNavCommand leaves questions and other requests to CORE", () => {
  for (const text of [
    "what's going on in Germany?", "tell me about Estonia", "news about AI", "what's the news about AI?",
    "go to sleep", "orbit, shut down", "open the pod bay doors", "show me how to cook pasta",
    "what are my stats?", "how is the studio doing", "open https://example.com", "go", "show me",
    "open intelligence and tell me about Germany", "review", "review this essay for me", "show me what's happening in Germany", "switch to 2d view",
    "remember that I like Estonia", "summarize the local news", "estonia", "the moon's orbit",
    // without context, bare / zoom words are CORE's
    "zoom in", "closer", "stats", "clips", "close stats", "analytics",
    // searches that aren't the news
    "search my memories for Estonia", "search google for cats", "search in my notes", "search x", "look up the weather",
    // LIFE: questions about focus/journals aren't commands
    "what is a focus timer?", "how does pomodoro work", "start a journal about my trip", "start focusing on the essay", "write in my journal that I slept well", "focus",
  ]) assert.equal(parseNavCommand(text), null, text);
});

test("parseNavCommand understands in-world commands in context", () => {
  const cases: [string, string | null, object | null][] = [
    ["zoom in", "intelligence", { panel: "intelligence", zoom: "in" }],
    ["Zoom in more, please", "studio", { panel: "studio", zoom: "in" }],
    ["zoom in a bit more", "creation", { panel: "creation", zoom: "in" }],
    ["closer", "intelligence", { panel: "intelligence", zoom: "in" }],
    ["get closer", null, { panel: null, zoom: "in" }],
    ["zoom out", null, { panel: null, zoom: "out" }],
    ["further", "studio", { panel: "studio", zoom: "out" }],
    ["go farther out", "intelligence", { panel: "intelligence", zoom: "out" }],
    ["reset the view", "studio", { panel: "studio", zoom: "reset" }],
    ["zoom out all the way", "intelligence", { panel: "intelligence", zoom: "reset" }],
    ["stats", "studio", { panel: "studio", view: "stats" }],
    ["statistics", "studio", { panel: "studio", view: "stats" }],
    ["analytics", "studio", { panel: "studio", view: "stats" }],
    ["open analytics", "studio", { panel: "studio", view: "stats" }],
    ["open analytics", null, { panel: "analytics" }],
    ["clips", "studio", { panel: "studio", view: "clips" }],
    ["clip factory", "studio", { panel: "studio", view: "clips" }],
    ["open clips", "studio", { panel: "studio", view: "clips" }],
    ["open clips", null, { panel: "studio", view: "clips" }],
    ["close stats", "studio", { panel: "studio", view: "none" }],
    ["close the clips", "studio", { panel: "studio", view: "none" }],
    ["my channel", "studio", { panel: "studio", view: "none" }],
    ["Germany", "intelligence", { panel: "intelligence", country: "Germany" }],
    ["local", "intelligence", { panel: "intelligence", country: "Estonia" }],
    ["news about AI", "intelligence", { panel: "intelligence", search: "ai" }],
    ["search for Brazil", "studio", { panel: "intelligence", country: "Brazil" }],
    ["show me news from Germany", "studio", { panel: "intelligence", country: "Germany" }],
    ["go back", "studio", { panel: null }],
    // stays with CORE even in context
    ["stats", "intelligence", null],
    ["close stats", "intelligence", null],
    ["Germany", "studio", null],
    ["home", "intelligence", null],
    ["what are my stats?", "studio", null],
    ["what's happening in Germany?", "intelligence", null],
    ["zoom", "intelligence", null],
  ];
  for (const [text, current, want] of cases) assert.deepEqual(parseNavCommand(text, { current: current as never }), want, `${text} @ ${current}`);
});

test("validateNav accepts only allowlisted places", () => {
  assert.deepEqual(validateNav({ target: "intelligence", country: "Germany" }), { panel: "intelligence", country: "Germany" });
  assert.deepEqual(validateNav({ target: "studio", view: "clips" }), { panel: "studio", view: "clips" });
  assert.deepEqual(validateNav({ target: "studio", view: "review" }), { panel: "studio", view: "review" });
  assert.deepEqual(validateNav({ target: "morning review" }), { panel: "studio", view: "review" });
  assert.deepEqual(validateNav({ target: "game dev" }), { panel: "creation" });
  assert.deepEqual(validateNav({ target: "galaxy" }), { panel: null });
  assert.equal(validateNav({ target: "https://evil.example" }), null);
  assert.equal(validateNav({ target: 42, view: "admin" }), null);
  assert.deepEqual(validateNav({ target: "intelligence", zoom: "in" }), { panel: null, zoom: "in" });
  assert.deepEqual(validateNav({ zoom: "reset" }), { panel: null, zoom: "reset" });
  assert.equal(validateNav({ zoom: "sideways" }), null);
  assert.deepEqual(validateNav({ target: "intelligence", search: "AI chips!" }), { panel: "intelligence", search: "ai chips" });
  assert.deepEqual(validateNav({ search: "Germany" }), { panel: "intelligence", country: "Germany" });
  assert.deepEqual(validateNav({ search: "" }), { panel: "intelligence", search: "" });
  assert.equal(validateNav({ search: "my memories" }), null);
  assert.equal((validateNav({ search: "x".repeat(500) }) as { search: string }).search.length, 80);
  assert.deepEqual(validateNav({ target: "studio", view: "none" }), { panel: "studio", view: "none" });
});

test("navReply says what happens", () => {
  assert.equal(navReply({ panel: "studio", zoom: "in" }), "Zooming in.");
  assert.equal(navReply({ panel: "intelligence", search: "ai" }), "Searching the news for “ai”.");
  assert.equal(navReply({ panel: "intelligence", search: "" }), "Showing the whole world.");
  assert.equal(navReply({ panel: "studio", view: "stats" }), "Flying to Studio → Stats.");
  assert.equal(navReply({ panel: "life", life: "focus", start: true }), "Focus timer started.");
  assert.equal(navReply({ panel: "life", life: "journal" }), "Flying to Life → Journal.");
  assert.deepEqual(validateNav({ target: "my journal" }), { panel: "life", life: "journal" });
});

test("navLabel reads naturally", () => {
  assert.equal(navLabel({ panel: "intelligence", country: "United States of America" }), "Intelligence → United States");
  assert.equal(navLabel({ panel: "studio", view: "stats" }), "Studio → Stats");
  assert.equal(navLabel({ panel: "studio", view: "review" }), "Studio → Clip review");
  assert.equal(navLabel({ panel: null }), "the galaxy");
});

test("bare 'search' stays with CORE outside the globe; fragments and how-to aren't searches", () => {
  for (const t of ["search for a good laptop", "search how to fix my bike", "search reddit for builds", "search for it", "search for", "search for what I said yesterday"])
    assert.equal(parseNavCommand(t), null, t);
  assert.deepEqual(parseNavCommand("search for a good laptop", { current: "intelligence" }), { panel: "intelligence", search: "a good laptop" });
  assert.equal(parseNavCommand("search for it", { current: "intelligence" }), null);
});

test("validateNav: empty optional fields don't override the target", () => {
  assert.deepEqual(validateNav({ target: "memory", search: "" }), parseNavCommand("open memory"));
  assert.deepEqual(validateNav({ target: "memory", view: "none" }), parseNavCommand("open memory"));
  assert.deepEqual(validateNav({ target: "studio", view: "stats", search: "" }), { panel: "studio", view: "stats" });
  assert.deepEqual(validateNav({ search: "oil" }), { panel: "intelligence", search: "oil" });
});

test("'eclipse' is the clips (common mishearing)", () => {
  for (const t of ["take me to the eclipse", "open the eclipse", "show me the clips in the studio"])
    assert.deepEqual(parseNavCommand(t), { panel: "studio", view: "clips" }, t);
});

test("'stats of the studio' (and the common mishearing 'the soda') opens studio stats", () => {
  for (const t of ["show me the stats of the studio", "show me the stats of the soda"]) assert.deepEqual(parseNavCommand(t, { current: "studio" }), { panel: "studio", view: "stats" }, t);
});

test("morning briefing aliases open the morning card", () => {
  for (const t of ["good morning", "Good morning, Orbit!", "hey orbit good morning", "morning briefing", "what's new today", "brief me", "brief me please", "open my morning briefing", "show me the daily briefing"])
    assert.deepEqual(parseNavCommand(t), { panel: null, morning: true }, t);
  assert.deepEqual(parseNavCommand("good morning", { current: "studio" }), { panel: null, morning: true });
  assert.deepEqual(parseNavCommand("brief me", { current: "intelligence" }), { panel: null, morning: true });
  assert.deepEqual(parseNavCommand("morning review"), { panel: "studio", view: "review" }); // still the clip review
  assert.equal(parseNavCommand("what's new in AI today?"), null);
  assert.equal(navReply({ panel: null, morning: true }), "Here's your morning briefing.");
  assert.deepEqual(validateNav({ target: "morning briefing" }), { panel: null, morning: true });
});

test("doctor aliases open the ORBIT doctor without leaving the current place", () => {
  for (const t of ["check orbit", "Check ORBIT please", "run diagnostics", "Orbit doctor", "hey orbit, run diagnostics", "is everything working", "Is everything working, Orbit?", "open the doctor", "run a health check"])
    assert.deepEqual(parseNavCommand(t), { panel: null, doctor: true }, t);
  assert.deepEqual(parseNavCommand("check orbit", { current: "studio" }), { panel: null, doctor: true });
  assert.equal(parseNavCommand("check"), null); // the "orbit" is needed
  assert.equal(parseNavCommand("is everything working in the studio"), null);
  assert.equal(navReply({ panel: null, doctor: true }), "Checking everything. One moment.");
  assert.deepEqual(validateNav({ target: "orbit doctor" }), { panel: null, doctor: true });
});

test("'what do you know about me' opens What ORBIT believes", () => {
  for (const t of ["What do you know about me?", "Orbit, what do you know about me", "show me what you know about me", "what does orbit know about me", "what orbit believes"])
    assert.deepEqual(parseNavCommand(t), { panel: "memory", beliefs: true }, t);
  assert.equal(parseNavCommand("what do you know about Germany?"), null);
  assert.equal(navReply({ panel: "memory", beliefs: true }), "Here's what I know about you.");
});
