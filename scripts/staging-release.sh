#!/usr/bin/env bash
# Usage: staging-release.sh deploy|rollback ROOT [40-character commit SHA]
set -euo pipefail
mode=${1:?deploy or rollback}
root=${2:?absolute staging root}
[[ "$root" = /* && "$root" =~ ^[a-zA-Z0-9_/-]+$ ]] || { echo 'Invalid staging root'; exit 1; }
[[ "$mode" = deploy || "$mode" = rollback ]] || exit 1
mkdir -p "$root"
exec 9>"$root/deployment.lock"
flock -n 9 || { echo 'Another staging deployment is running'; exit 1; }
export STAGING_ENV_FILE="$root/shared/staging.env"
[[ -f "$STAGING_ENV_FILE" ]] || { echo 'Missing shared/staging.env'; exit 1; }
compose() { docker compose --project-name subtitle-staging --env-file "$STAGING_ENV_FILE" -f "$release/docker-compose.staging.yml" "$@"; }
activate() {
  compose up -d --no-build --wait --wait-timeout 180 postgres media web worker
  # Nginx resolves upstream IPs at startup; recreate it after application containers.
  compose up -d --no-build --force-recreate --wait gateway
}
previous=$(readlink -f "$root/current" 2>/dev/null || true)
if [[ "$mode" = rollback ]]; then
  release=$(readlink -f "$root/previous" 2>/dev/null || true)
  [[ -n "$release" && -f "$release/.cutover-ready" ]] || { echo 'No previously verified staging release'; exit 1; }
  export STAGING_RELEASE=$(basename "$release")
  [[ "$STAGING_RELEASE" =~ ^[0-9a-f]{40}$ ]] || exit 1
  activate
  ln -sfn "$release" "$root/current.next"; mv -Tf "$root/current.next" "$root/current"
  echo "Rolled staging back to $STAGING_RELEASE; volumes and schema retained."
  exit 0
fi
export STAGING_RELEASE=${3:?commit SHA}
[[ "$STAGING_RELEASE" =~ ^[0-9a-f]{40}$ ]] || exit 1
release="$root/releases/$STAGING_RELEASE"
[[ -f "$release/src/durable/ownership.js" ]] || { echo 'Release lacks the file-access boundary'; exit 1; }
compose config --quiet
# Smoke fixture lives outside releases; the deployment account controls it.
[[ -f "$root/shared/smoke.mp4" ]] || { echo 'Missing shared/smoke.mp4 (small authorized speech fixture)'; exit 1; }
compose config --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const e=JSON.parse(s).services.web.environment;if(!e.SESSION_SECRET||e.SESSION_SECRET.length<32||e.SESSION_SECRET.startsWith("replace-")||e.DATABASE_URL.includes("change-me-before-deploy"))process.exit(1)})'
compose build media web
if [[ -n "$previous" && "$previous" != "$release" && -f "$previous/.cutover-ready" ]]; then ln -sfn "$previous" "$root/previous"; fi
activate
# Run on the host with Node 22+. Base URL must be the real HTTPS staging origin.
# Read the value through Compose, without sourcing the env file as shell code.
base=$(compose config --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).services.web.environment.SITE_URL||""))')
[[ "$base" = https://* ]] || { echo 'SITE_URL must be the HTTPS staging origin'; exit 1; }
if ! SMOKE_BASE_URL="$base" SMOKE_VIDEO="$root/shared/smoke.mp4" node "$release/scripts/staging-smoke.mjs"; then
  echo 'Smoke failed. Staging was not marked current; use rollback after inspecting logs.'
  echo 'No production services or volumes have been changed.'
  exit 1
fi
touch "$release/.cutover-ready"
if [[ -n "$previous" && "$previous" != "$release" && -f "$previous/.cutover-ready" ]]; then ln -sfn "$previous" "$root/previous"; fi
ln -sfn "$release" "$root/current.next"; mv -Tf "$root/current.next" "$root/current"
echo "Staging release $STAGING_RELEASE verified."
