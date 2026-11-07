#!/usr/bin/env bash
# Builder boundary check on Linux (run as root): three accounts laid out the way supervisor/windows/install.ps1 lays out the PC,
# with POSIX permissions standing in for the Windows ACLs, then supervisor/boundary-probe.mjs run AS THE BUILDER, as a
# model-written test would run (node --test from a builder worktree). This proves the design; the Windows ACLs themselves
# still need the same probe run there (see supervisor/README.md).
#   orbit-owner   = Andreas: live install, stage build, ORBIT data
#   orbit-sup     = the supervisor (SYSTEM on Windows): token, config, state, audit, code, snapshots, mirror, the git remote
#   orbit-builder = the builder: its own home and worktree only; may create files in inbox/, read public/ and the mirror
#   orbit-build   = the release build: its stage and npm cache only; reads the mirror. Runs the submitted code at build time and
#                   dependency install scripts, so the probe also runs from a page executed by `next build` and from a postinstall.
# FULL=0 skips the real build (about 5 min: fresh npm ci + next build as orbit-build).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 2; }
REPO=$(cd "$(dirname "$0")/.." && pwd); B=${1:-/srv/orbit-boundary}
for u in orbit-owner orbit-sup orbit-builder orbit-build; do id -u $u >/dev/null 2>&1 || useradd -r -M -s /usr/sbin/nologin $u; done
pkill -u orbit-sup 2>/dev/null || true; pkill -u orbit-build 2>/dev/null || true; rm -rf "$B"; mkdir -p "$B"; chmod 755 "$B"
# Each account starts with an empty environment, like a scheduled task: nothing from this shell (tokens included) leaks in.
asu() { local u=$1; shift; runuser -u "$u" -- env -i PATH="$PATH" LANG=C.UTF-8 HOME=/nonexistent "$@"; }
ROOTGIT=$(mktemp); printf '[safe]\n\tdirectory = *\n' > $ROOTGIT # root setting up other accounts' repos

# supervisor home (C:\ProgramData\orbit-supervisor): traverse-only, private files, inbox create-only (sticky), public/releases/mirror readable
S=$B/sup; mkdir -p $S/{app/windows,inbox,ctl,public,releases}
cp "$REPO"/supervisor/*.ts "$REPO"/supervisor/package.json $S/app/; cp "$REPO"/supervisor/windows/*.ps1 $S/app/windows/
echo "ghp_drilltokendrilltokendrilltoken00" > $S/token.txt; echo '{}' > $S/config.json; echo '{}' > $S/state.json
: > $S/audit.jsonl; echo stop > $S/STOP; echo '{}' > $S/public/status.json; echo '{}' > $S/inbox/existing-by-supervisor.keep
git clone -q --bare "$REPO" $S/mirror.git; git clone -q --bare "$REPO" $B/origin.git
ORIGIN_MAIN=$(git -C $B/origin.git rev-parse HEAD)
chown -R orbit-sup:orbit-sup $S $B/origin.git
chmod 711 $S; chmod 600 $S/{token.txt,config.json,state.json,audit.jsonl,STOP} $S/inbox/existing-by-supervisor.keep
getent group orbit-inbox >/dev/null || groupadd -r orbit-inbox; usermod -aG orbit-inbox orbit-owner; usermod -aG orbit-inbox orbit-builder
chgrp orbit-inbox $S/inbox; chmod 700 $S/ctl; chmod 1730 $S/inbox; # owner + builder may add files (sticky: only to their own); build and others can't chmod -R a+rX,go-w $S/app $S/public $S/releases $S/mirror.git; chmod -R go-w $B/origin.git

# owner side (Documents\orbit, %LOCALAPPDATA%\orbit-stage, %LOCALAPPDATA%\orbit): private to the owner
git clone -q "$REPO" $B/live; mkdir -p $B/live/.next $B/data
echo SECRET=1 > $B/live/.env.local; echo id > $B/live/.next/BUILD_ID; echo '{"on":true}' > $B/data/stop-all.json
chown -R orbit-owner:orbit-owner $B/live $B/data; chmod 700 $B/live $B/data
# build side (C:\orbit-stage, C:\orbit-build-cache): private to orbit-build
mkdir -p $B/stage/.next $B/build-cache; echo id > $B/stage/.next/BUILD_ID
chown -R orbit-build:orbit-build $B/stage $B/build-cache; chmod 700 $B/stage $B/build-cache

# builder (its own account): a worktree cloned from the mirror, the probe dropped in as a test file
H=$B/builder; mkdir -p $H; chown orbit-builder:orbit-builder $H; chmod 700 $H
printf '[safe]\n\tdirectory = %s\n' "$S/mirror.git" > $H/gitconfig; chown orbit-builder $H/gitconfig   # what builder.ts writes at start
asu orbit-builder env GIT_CONFIG_GLOBAL=$H/gitconfig git clone -q $S/mirror.git $H/repo
asu orbit-builder cp "$REPO/supervisor/boundary-probe.mjs" $H/repo/tests/zz-boundary.test.mjs

# a stand-in supervisor process holding a secret in its environment
asu orbit-sup env SUPERVISOR_SECRET=s3cret sleep 600 & SPID=$!; sleep 1; SPID=$(pgrep -u orbit-sup -f "sleep 600" | head -1)

cd $H/repo
set +e
asu orbit-builder env PROBE_ROLE=builder PROBE_OWN=$H PROBE_SUP=$S PROBE_LIVE=$B/live PROBE_STAGE=$B/stage PROBE_DATA=$B/data PROBE_SUP_PID=$SPID PROBE_ORIGIN=$B/origin.git \
  GIT_CONFIG_GLOBAL=$H/gitconfig node --test tests/zz-boundary.test.mjs 2>&1 | grep -E "^(ok|not ok)|# (pass|fail)|builder (could|can't)"
rc=${PIPESTATUS[0]}

if [ "${FULL:-1}" = 1 ]; then
  # A submission whose code runs during `next build`: a static page that runs the probe while it is prerendered.
  W=$B/submit; git clone -q "$REPO" $W; mkdir -p $W/src/app/selfdev-probe
  cat > $W/src/app/selfdev-probe/page.tsx <<'TSX'
// Boundary drill only: runs the probe while `next build` prerenders this page, as the build account.
import { spawnSync } from "node:child_process";
export const dynamic = "force-static";
export default function Probe() {
  if (process.env.PROBE_REPORT) spawnSync(process.execPath, ["supervisor/boundary-probe.mjs", "--report", process.env.PROBE_REPORT], { stdio: "inherit" });
  return <p>probe</p>;
}
TSX
  cp "$REPO/supervisor/boundary-probe.mjs" $W/supervisor/ # the probe as it is in this checkout, not as last committed
  git -C $W -c user.name=drill -c user.email=d@x add -A; git -C $W -c user.name=drill -c user.email=d@x commit -qm "boundary drill: build-time probe"
  PC=$(git -C $W rev-parse HEAD); GIT_CONFIG_GLOBAL=$ROOTGIT git -C $W push -q $S/mirror.git HEAD:refs/heads/probe; chown -R orbit-sup:orbit-sup $S/mirror.git; chmod -R a+rX,go-w $S/mirror.git
  # A dependency with an install script that runs the probe.
  P=$B/probe-pkg; mkdir -p $P; cp "$REPO/supervisor/boundary-probe.mjs" $P/
  printf '{"name":"orbit-probe-pkg","version":"1.0.0","scripts":{"postinstall":"node boundary-probe.mjs --report %s"}}' "$B/build-cache/probe-install.json" > $P/package.json
  chmod -R a+rX $P; cp "${NODE_EXTRA_CA_CERTS:-/dev/null}" $B/ca.crt 2>/dev/null; chmod a+r $B/ca.crt 2>/dev/null
  PENV=(PROBE_ROLE=build PROBE_OWN=$B/build-cache PROBE_SUP=$S PROBE_LIVE=$B/live PROBE_STAGE=$B/stage PROBE_DATA=$B/data PROBE_SUP_PID=$SPID PROBE_ORIGIN=$B/origin.git
        HTTPS_PROXY=${HTTPS_PROXY:-} HTTP_PROXY=${HTTP_PROXY:-} NO_PROXY=${NO_PROXY:-} HOME=$B/build-cache npm_config_cache=$B/build-cache/npm NODE_EXTRA_CA_CERTS=$B/ca.crt SSL_CERT_FILE=$B/ca.crt npm_config_cafile=$B/ca.crt GIT_CONFIG_GLOBAL=$B/build-cache/gitconfig NEXT_TELEMETRY_DISABLED=1)
  printf '[safe]\n\tdirectory = %s\n' "$S/mirror.git" > $B/build-cache/gitconfig; chown orbit-build $B/build-cache/gitconfig
  echo "== build as orbit-build: fresh clone, npm ci, install script, next build (what release-build.ps1 does)"
  asu orbit-build env "${PENV[@]}" bash -c "set -e; cd $B/stage; find . -mindepth 1 -delete; git clone -q --no-checkout $S/mirror.git .; git checkout -q --detach $PC
    npm ci --no-audit --no-fund > $B/build-cache/npm-ci.log 2>&1
    npm install --no-save $P > $B/build-cache/npm-probe.log 2>&1 || true
    PROBE_REPORT=$B/build-cache/probe-build.json node node_modules/next/dist/bin/next build > $B/build-cache/next-build.log 2>&1" || { echo "FAIL build as orbit-build (see $B/build-cache/*.log)"; rc=1; }
  pkill -9 -u orbit-build 2>/dev/null # what trigger-build does before the snapshot
  for r in install build; do
    f=$B/build-cache/probe-$r.json
    if [ -f $f ]; then node -e 'const r=require(process.argv[1]); for (const x of r.results) console.log(`${x.ok?"ok  ":"FAIL"} [${process.argv[2]}] ${x.what}: ${x.got}`); process.exit(r.pass?0:1)' $f $r | grep -E "FAIL|^ok" | sed -n '1,200p' | awk '/FAIL/{f=1} {print} END{exit f}' > /tmp/probe-$r.out; prc=$?
      echo "$(grep -c '^ok' /tmp/probe-$r.out) ok, $(grep -c FAIL /tmp/probe-$r.out) failed: probe during $r"; grep FAIL /tmp/probe-$r.out; [ $prc = 0 ] || rc=1
    else echo "FAIL probe during $r never ran"; rc=1; fi
  done
  [ -f $B/stage/.next/BUILD_ID ] && grep -q "selfdev-probe" $B/build-cache/next-build.log && echo "ok   the build ran the submitted page" || { echo "FAIL build output missing"; rc=1; }
fi
pkill -u orbit-sup 2>/dev/null
[ "$(GIT_CONFIG_GLOBAL=$ROOTGIT git -C $B/origin.git rev-parse HEAD)" = "$ORIGIN_MAIN" ] && echo "ok   origin main unchanged" || { echo "FAIL origin main moved"; rc=1; }
[ "$(cat $S/STOP)" = stop ] && [ "$(cat $B/data/stop-all.json)" = '{"on":true}' ] && [ "$(cat $B/live/.next/BUILD_ID)" = id ] && echo "ok   stop flags unchanged" || { echo "FAIL a stop flag changed"; rc=1; }
[ $rc = 0 ] && echo "BOUNDARY CHECK PASSED" || echo "BOUNDARY CHECK FAILED"
exit $rc
