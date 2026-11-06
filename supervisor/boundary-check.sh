#!/usr/bin/env bash
# Builder boundary check on Linux (run as root): three accounts laid out the way supervisor/windows/install.ps1 lays out the PC,
# with POSIX permissions standing in for the Windows ACLs, then supervisor/boundary-probe.mjs run AS THE BUILDER, as a
# model-written test would run (node --test from a builder worktree). This proves the design; the Windows ACLs themselves
# still need the same probe run there (see supervisor/README.md).
#   orbit-owner   = Andreas: live install, stage build, ORBIT data
#   orbit-sup     = the supervisor (SYSTEM on Windows): token, config, state, audit, code, snapshots, mirror, the git remote
#   orbit-builder = the builder: its own home and worktree only; may create files in inbox/, read public/ and the mirror
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 2; }
REPO=$(cd "$(dirname "$0")/.." && pwd); B=${1:-/srv/orbit-boundary}
for u in orbit-owner orbit-sup orbit-builder; do id -u $u >/dev/null 2>&1 || useradd -r -M -s /usr/sbin/nologin $u; done
pkill -u orbit-sup 2>/dev/null || true; rm -rf "$B"; mkdir -p "$B"; chmod 755 "$B"
asu() { local u=$1; shift; runuser -u "$u" -- "$@"; }

# supervisor home (C:\ProgramData\orbit-supervisor): traverse-only, private files, inbox create-only (sticky), public/releases/mirror readable
S=$B/sup; mkdir -p $S/{app/windows,inbox,ctl,public,releases}
cp "$REPO"/supervisor/*.ts "$REPO"/supervisor/package.json $S/app/; cp "$REPO"/supervisor/windows/*.ps1 $S/app/windows/
echo "ghp_drilltokendrilltokendrilltoken00" > $S/token.txt; echo '{}' > $S/config.json; echo '{}' > $S/state.json
: > $S/audit.jsonl; echo stop > $S/STOP; echo '{}' > $S/public/status.json; echo '{}' > $S/inbox/existing-by-supervisor.json
git clone -q --bare "$REPO" $S/mirror.git; git clone -q --bare "$REPO" $B/origin.git
ORIGIN_MAIN=$(git -C $B/origin.git rev-parse HEAD)
chown -R orbit-sup:orbit-sup $S $B/origin.git
chmod 711 $S; chmod 600 $S/{token.txt,config.json,state.json,audit.jsonl,STOP} $S/inbox/existing-by-supervisor.json
chmod 700 $S/ctl; chmod 1733 $S/inbox; chmod -R a+rX,go-w $S/app $S/public $S/releases $S/mirror.git; chmod -R go-w $B/origin.git

# owner side (Documents\orbit, %LOCALAPPDATA%\orbit-stage, %LOCALAPPDATA%\orbit): private to the owner
git clone -q "$REPO" $B/live; mkdir -p $B/live/.next $B/stage/.next $B/data
echo SECRET=1 > $B/live/.env.local; echo id > $B/live/.next/BUILD_ID; echo id > $B/stage/.next/BUILD_ID; echo '{"on":true}' > $B/data/stop-all.json
chown -R orbit-owner:orbit-owner $B/live $B/stage $B/data; chmod 700 $B/live $B/stage $B/data

# builder (its own account): a worktree cloned from the mirror, the probe dropped in as a test file
H=$B/builder; mkdir -p $H; chown orbit-builder:orbit-builder $H; chmod 700 $H
printf '[safe]\n\tdirectory = %s\n' "$S/mirror.git" > $H/gitconfig; chown orbit-builder $H/gitconfig   # what builder.ts writes at start
asu orbit-builder env GIT_CONFIG_GLOBAL=$H/gitconfig git clone -q $S/mirror.git $H/repo
asu orbit-builder cp "$REPO/supervisor/boundary-probe.mjs" $H/repo/tests/zz-boundary.test.mjs

# a stand-in supervisor process holding a secret in its environment
asu orbit-sup env SUPERVISOR_SECRET=s3cret sleep 600 & SPID=$!; sleep 1; SPID=$(pgrep -u orbit-sup -f "sleep 600" | head -1)

cd $H/repo
set +e
asu orbit-builder env PROBE_SUP=$S PROBE_LIVE=$B/live PROBE_STAGE=$B/stage PROBE_DATA=$B/data PROBE_SUP_PID=$SPID PROBE_ORIGIN=$B/origin.git \
  GIT_CONFIG_GLOBAL=$H/gitconfig node --test tests/zz-boundary.test.mjs 2>&1 | grep -E "^(ok|not ok)|# (pass|fail)|builder (could|can't)"
rc=${PIPESTATUS[0]}
pkill -u orbit-sup 2>/dev/null
[ "$(git -c safe.directory='*' -C $B/origin.git rev-parse HEAD)" = "$ORIGIN_MAIN" ] && echo "ok   origin main unchanged" || { echo "FAIL origin main moved"; rc=1; }
[ "$(cat $S/STOP)" = stop ] && [ "$(cat $B/data/stop-all.json)" = '{"on":true}' ] && echo "ok   stop flags unchanged" || { echo "FAIL a stop flag changed"; rc=1; }
[ $rc = 0 ] && echo "BOUNDARY CHECK PASSED" || echo "BOUNDARY CHECK FAILED"
exit $rc
