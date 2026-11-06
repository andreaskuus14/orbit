#!/usr/bin/env bash
# Supervisor drill in an isolated environment (Linux/macOS/Git Bash): bash supervisor/drill.sh [drill-dir] [port]
# Uses this checkout's HEAD as "GitHub" (a bare repo), a separate live folder with ORBIT_ISOLATED=1, a dummy Supabase that
# refuses connections, its own data folder and port. No model, no network, no live data. Proves:
#   1. a good release is merged, built, installed and kept, and a supervisor killed mid-monitoring resumes without repeating steps;
#   2. a release touching the health route is refused; a release that breaks a monitored page is rolled back to the previous snapshot, main is reverted, releases halt;
#   3. the app can't clear a halt; emergency stop works; the audit chain is intact.
# Needs node_modules in this checkout. Takes ~10 min (three production builds). Exit 0 = all passed.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
D=$(realpath -m "${1:-${TMPDIR:-/tmp}/orbit-drill}"); PORT=${2:-3210}
rm -rf "$D"; mkdir -p "$D"/{bin,data,sup/inbox,supapp}
FAIL=0; ok() { echo "ok   $1"; }; bad() { echo "FAIL $1"; FAIL=1; }
cleanup() { pkill -f "$D/supapp/supervisor.ts" 2>/dev/null || true; "$D/bin/stop.sh" 2>/dev/null || true; }
trap cleanup EXIT

git clone -q --bare "$REPO" "$D/origin.git"
git -C "$D/origin.git" update-ref refs/heads/main "$(git -C "$REPO" rev-parse HEAD)"
git -C "$D/origin.git" symbolic-ref HEAD refs/heads/main
for d in live stage work; do git clone -q -b main "$D/origin.git" "$D/$d"; ln -s "$REPO/node_modules" "$D/$d/node_modules"; done
cp "$REPO"/supervisor/*.ts "$REPO/supervisor/package.json" "$D/supapp/" # the installed copy

cat > "$D/bin/env.sh" <<EOF
export ORBIT_ISOLATED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=isolated ORBIT_DATA_DIR=$D/data NEXT_TELEMETRY_DISABLED=1
unset SUPABASE_SECRET_KEY YOUTUBE_API_KEY VOYAGE_API_KEY NTFY_TOPIC RESEND_API_KEY TELEGRAM_BOT_TOKEN
EOF
cat > "$D/bin/start.sh" <<EOF
#!/usr/bin/env bash
. $D/bin/env.sh; cd $D/live
setsid nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $PORT >> orbit-server.log 2>&1 < /dev/null &
echo \$! > orbit-server.pid
EOF
cat > "$D/bin/stop.sh" <<EOF
#!/usr/bin/env bash
cd $D/live; [ -f orbit-server.pid ] && { kill -- -\$(cat orbit-server.pid) 2>/dev/null || kill \$(cat orbit-server.pid) 2>/dev/null || true; }
for i in \$(seq 1 40); do (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null || exit 0; sleep 0.5; done; echo "port $PORT still in use" >&2; exit 1
EOF
cat > "$D/bin/build.sh" <<EOF
#!/usr/bin/env bash
set -e; . $D/bin/env.sh; cd "\$2"; git fetch -q "\$3" "\$1"; git checkout -q --detach "\$1"; rm -rf .next
node node_modules/next/dist/bin/next build > $D/last-build.log 2>&1
EOF
chmod +x "$D"/bin/*.sh
cat > "$D/sup/config.json" <<EOF
{ "repoUrl": "$D/origin.git", "mainBranch": "main", "liveDir": "$D/live", "distDir": ".next", "stageDir": "$D/stage",
  "healthUrl": "http://127.0.0.1:$PORT/api/health", "serverLog": "$D/live/orbit-server.log",
  "commands": { "build": ["$D/bin/build.sh", "{commit}", "{stage}", "{mirror}"], "stop": ["$D/bin/stop.sh"], "start": ["$D/bin/start.sh"] },
  "github": null, "allowWithoutExternalChecks": true,
  "workflowChecks": [ { "name": "sign-in page", "url": "http://127.0.0.1:$PORT/login", "expect": 200 }, { "name": "public demo", "url": "http://127.0.0.1:$PORT/demo", "expect": 200 } ],
  "monitor": { "probes": 3, "intervalSec": 5, "maxErrors": 0, "startupTimeoutSec": 90 },
  "dataBackup": { "paths": ["$D/data"], "maxBytes": 200000000 }, "keepReleases": 5, "pollSec": 3 }
EOF
export ORBIT_SUPERVISOR_HOME="$D/sup"
SUP() { node --no-warnings --experimental-strip-types "$D/supapp/supervisor.ts" "$@"; }
watch_sup() { (cd "$D/supapp" && setsid nohup node --no-warnings --experimental-strip-types "$D/supapp/supervisor.ts" watch >> "$D/supervisor.log" 2>&1 < /dev/null &); }
wait_for() { local t=$((SECONDS + ${2:-900})); until grep -qE "$1" "$D/supervisor.log" 2>/dev/null; do [ $SECONDS -gt $t ] && return 1; sleep 1; done; }
health() { curl -s "http://127.0.0.1:$PORT/api/health" || true; }

submit() { # submit <id> <title>: the commit at HEAD of $D/work, based on its parent
  local base; base=$(git -C "$D/work" rev-parse HEAD~1)
  git -C "$D/work" bundle create -q "$D/sup/inbox/$1.bundle" "$base..HEAD"
  printf '{"id":"%s","taskId":"drill:%s","branch":"selfdev/%s","source":"bundle","commit":"%s","base":"%s","title":"%s","why":"drill","acceptance":[],"checks":[{"name":"drill","ok":true}],"costUsd":0}' \
    "$1" "$1" "$1" "$(git -C "$D/work" rev-parse HEAD)" "$base" "$2" > "$D/sup/inbox/$1.json.tmp"
  mv "$D/sup/inbox/$1.json.tmp" "$D/sup/inbox/$1.json"
}

echo "== baseline build"; (. "$D/bin/env.sh"; cd "$D/live" && node node_modules/next/dist/bin/next build > "$D/live-build.log" 2>&1)
"$D/bin/start.sh"; for i in $(seq 1 60); do health | grep -q '"ok":true' && break; sleep 1; done
health | grep -q '"isolated":true' && ok "isolated instance healthy" || bad "isolated instance not healthy"
[ -z "$(ls -A "$D/data")" ] && ok "no background work wrote data" || bad "isolated instance wrote data: $(ls "$D/data")"
echo '{"store":"before the releases"}' > "$D/data/store.json"
SUP adopt >/dev/null; watch_sup

echo "== 1. good release, supervisor killed mid-monitoring"
echo "Drill release $(date -u +%FT%TZ)." >> "$D/work/docs/RECOVERY.md"
git -C "$D/work" -c user.name=drill -c user.email=d@x commit -qam "Drill: docs-only release"; GOOD=$(git -C "$D/work" rev-parse HEAD)
submit drill-good "Drill: docs-only release"
wait_for "drill-good: installed" && pkill -9 -f "$D/supapp/supervisor.ts watch" && sleep 2 && watch_sup
wait_for "drill-good: (retained|failed|rolledBack|halted|rejected)" 300 || true
grep -q "drill-good: retained" "$D/supervisor.log" && ok "good release kept after a supervisor restart" || bad "good release not kept"
health | grep -q "\"commit\":\"$GOOD\"" && ok "live runs the released commit" || bad "live doesn't run $GOOD"
[ "$(grep -c '"release.merged"' "$D/sup/audit.jsonl")" = 1 ] && [ "$(grep -c '"release.built"' "$D/sup/audit.jsonl")" = 1 ] && ok "merge and build ran once" || bad "a step repeated"
grep -q '"resuming":"drill-good","step":"installed"' "$D/sup/audit.jsonl" && ok "restart resumed at 'installed'" || bad "restart didn't resume the step"

echo "== 2a. a release may not touch the health check it is judged by"
sed -i 's/    ok: true,/    ok: false, \/\/ drill/' "$D/work/src/app/api/health/route.ts"
git -C "$D/work" -c user.name=drill -c user.email=d@x commit -qam "Drill: health route change"
submit drill-health "Drill: health route change"
wait_for "drill-health: (rejected|halted|retained|rolledBack)" 120 || true
grep -q "drill-health: rejected (release policy: src/app/api/health" "$D/supervisor.log" && ok "health-route change refused by policy" || bad "health-route change not refused"
git -C "$D/work" reset -q --hard HEAD~1

echo "== 2b. release that breaks a monitored page"
sed -i 's/export const dynamic = "force-static";/export const dynamic = "force-dynamic";/; s/  const data = demoData();/  if (process.env.ORBIT_DRILL_OK !== "1") throw new Error("drill: broken page"); const data = demoData();/' "$D/work/src/app/demo/page.tsx"
git -C "$D/work" -c user.name=drill -c user.email=d@x commit -qam "Drill: broken demo page"
submit drill-bad "Drill: broken demo page"
wait_for "drill-bad: (rolledBack|halted|retained|rejected)" 900 || true
grep -q "drill-bad: rolledBack" "$D/supervisor.log" && ok "failed release rolled back" || bad "no rollback"
health | grep -q "\"commit\":\"$GOOD\"" && ok "previous release restored and healthy" || bad "previous release not restored"
[ "$(git -C "$D/origin.git" rev-parse 'main^{tree}')" = "$(git -C "$D/origin.git" rev-parse "$GOOD^{tree}")" ] && ok "main reverted to the restored code" || bad "main not reverted"
ls "$D/sup/releases/drill-bad/data/0/store.json" >/dev/null 2>&1 && ok "data backed up (restore verified before install)" || bad "no data backup"
SUP status | grep -q '"halted": "drill-bad' && ok "releases halted" || bad "not halted"

echo "== 3. controls and audit"
echo '{"action":"clear"}' > "$D/sup/inbox/control-1.json"; echo '{"action":"stop"}' > "$D/sup/inbox/control-2.json"; sleep 8
grep -q '"control.ignored"' "$D/sup/audit.jsonl" && SUP status | grep -q '"halted": "drill-bad' && ok "the app can't clear a halt" || bad "app cleared a halt"
[ -f "$D/sup/STOP" ] && ok "emergency stop from the app" || bad "stop not applied"
SUP verify-audit | grep -q intact && ok "audit chain intact" || bad "audit chain broken"

[ $FAIL = 0 ] && echo "DRILL PASSED ($D)" || echo "DRILL FAILED ($D)"
exit $FAIL
