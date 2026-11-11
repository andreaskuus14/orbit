// L03: data ownership across two users (README.md here). User A is the harness's test user (it owns tasks, chats, memories … by now);
// user B is a second throwaway account on the same local Supabase. B must not read, change, delete or create A's rows in any user
// table (RLS), and B, who isn't in ORBIT_ALLOWED_EMAILS, must not get through ORBIT's own API, whose server code often uses the
// service key (which bypasses RLS).
const L = require("./lib.cjs");
const { createRequire } = require("node:module");
const { createClient } = createRequire(require("node:path").join(L.ROOT, "package.json"))("@supabase/supabase-js");

const TABLES = ["agents", "articles", "automations", "briefings", "conversations", "core_playbook", "events", "feeds", "game_saves", "goals", "job_runs",
  "memories", "memory_facts", "memory_links", "messages", "missions", "profiles", "projects", "proposals", "prospects", "tasks", "usage"];
const owner = (t) => (t === "profiles" ? "id" : "user_id");

(async () => {
  const c = L.conf(), opts = { auth: { persistSession: false } };
  const admin = createClient(c.apiUrl, c.serviceKey, opts);
  const missing = L.sql("select string_agg(relname, ',') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
  L.ok("rls: every public table has row-level security on", !missing, missing || "all on");
  const unlisted = L.sql("select string_agg(relname, ',') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'").split(",").filter((t) => t && !TABLES.includes(t));
  L.ok("rls: this check covers every public table", !unlisted.length, unlisted.join(", ") || `${TABLES.length} tables`);

  const a = createClient(c.apiUrl, c.anonKey, opts);
  const { data: ain, error: aerr } = await a.auth.signInWithPassword({ email: c.email, password: c.password });
  if (aerr) throw aerr;
  const A = ain.user.id, bEmail = "rls-b@example.test", bPw = `B-${L.tag()}-Aa1!`;
  const { data: list } = await admin.auth.admin.listUsers();
  const old = list.users.find((u) => u.email === bEmail);
  if (old) await admin.auth.admin.updateUserById(old.id, { password: bPw }); else await admin.auth.admin.createUser({ email: bEmail, password: bPw, email_confirm: true });
  const b = createClient(c.apiUrl, c.anonKey, opts);
  const { data: bin, error: berr } = await b.auth.signInWithPassword({ email: bEmail, password: bPw });
  if (berr) throw berr;

  const leaks = [], writes = [];
  let attacked = 0;
  for (const t of TABLES) {
    const { data: seen } = await b.from(t).select(owner(t)).neq(owner(t), bin.user.id).limit(5);
    if (seen?.length) leaks.push(`${t}:${seen.length}`);
    const { data: mine } = await admin.from(t).select("id").eq(owner(t), A).limit(1);
    if (mine?.length && mine[0].id !== undefined) {
      attacked++;
      const { data: upd } = await b.from(t).update({ [owner(t)]: bin.user.id }).eq("id", mine[0].id).select("id");
      const { data: del } = await b.from(t).delete().eq("id", mine[0].id).select("id");
      const { data: still } = await admin.from(t).select("id").eq("id", mine[0].id).eq(owner(t), A);
      if (upd?.length || del?.length || still?.length !== 1) writes.push(`${t}: changed`);
    }
    const { error: ins } = await b.from(t).insert({ [owner(t)]: A });
    if (!ins) writes.push(`${t}: insert as A accepted`);
  }
  L.ok("rls: B reads none of A's rows in any table", !leaks.length, leaks.join(", ") || `${TABLES.length} tables`);
  L.ok("rls: B can't update, delete or create rows as A", !writes.length, writes.join("; ") || `${attacked} existing rows attacked, ${TABLES.length} inserts refused`);

  // ORBIT's API: B signs in through the real login page; the allowlist must stop B before any route (service-key reads included)
  const { chromium } = (() => { const r = createRequire(require("node:path").join(L.ROOT, "package.json")); try { return r("playwright"); } catch { return r("playwright-core"); } })();
  const browser = await chromium.launch(), page = await browser.newPage();
  await page.goto(`${L.BASE}/login`);
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await page.getByLabel("Email").fill(bEmail);
  await page.getByLabel("Password").fill(bPw);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await L.sleep(4000);
  const routes = ["/api/tasks", "/api/memories", "/api/core/chats", "/api/business", "/api/export", "/api/doctor"];
  const res = [];
  for (const r of routes) res.push([r, await page.evaluate(async (u) => { const x = await fetch(u, { redirect: "manual" }); return x.status; }, r)]);
  const through = res.filter(([, s]) => s >= 200 && s < 300);
  L.ok("app: a signed-in account that isn't allowlisted gets no data from ORBIT's API", !through.length, res.map(([r, s]) => `${r} ${s}`).join(", "));
  await browser.close();
  await admin.auth.admin.deleteUser((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === bEmail).id);
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
