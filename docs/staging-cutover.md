# Step 8: staging and cutover

## What is ready

- Streaming multipart uploads go through Nginx with request buffering disabled,
  then through a bounded disk stream. Disconnects remove partial files.
- Durable session/job/SRT/version/media access requires the signed `subtitle_owner`
  HttpOnly, SameSite=Strict cookie. Secure is enabled by default. IDs and file names
  alone are no longer credentials. Range responses have the same access check.
- TTL retains queued/running inputs even after session expiry; cleanup removes
  expired metadata/history and unreferenced files only after work finishes.
- `Staging deployment` is a manual GitHub Actions workflow; it deploys an immutable
  commit into an isolated Compose project and runs the full acceptance command.
- Existing CI uses real PostgreSQL and separate web/media/worker processes, with
  stub media executables. It tests owner isolation, downloads/Range, cancellation,
  aborted streaming, active-file retention and the reusable staging smoke command.
  CI is not proof that Whisper/model download works on your actual VPS.

## Browser ownership and upgrade

Set the same random `SESSION_SECRET` (at least 32 characters) in web and media.
Keep it across deployments and rollbacks; rotation invalidates browser ownership.
This is anonymous browser ownership, not an account/login system. Clearing the
cookie or changing browsers loses access. Copying a task URL does not share access.
A stolen valid cookie still grants that browser's access.

The schema change adds a nullable owner column. Pre-step-8 sessions have no owner
and are denied rather than assigned to the first visitor. Drain existing jobs and
announce this boundary before production cutover. Old media and PostgreSQL volumes
must be preserved/backed up. Do not roll back to a build predating ownership: it
would restore public file access. This PR does not silently delete legacy data.
The original backend-only mode is for local compatibility; it does not provide
these access guarantees and must not be used for the public cutover.

## One-time staging setup

Use a separate hostname/VPS or isolated local port. The staging Compose project
is `subtitle-staging`, binds only `127.0.0.1:8081`, and has its own DB/media/model
volumes. Production uses a different project and port. Budget worker memory/CPU;
do not run two large Whisper models on an undersized host.

The deployment account needs Docker access, GitHub SSH access is not required.
Install Docker Compose v2 with `--wait` support, Node 22+, `flock`, tar and bash.
On the server create `/srv/subtitle-staging/shared/staging.env` (mode 600) using
`.env.example` as the starting point, with at least:

```dotenv
POSTGRES_PASSWORD=<unique URL-safe random password>
SESSION_SECRET=<unique random secret, at least 32 characters>
COOKIE_SECURE=true
SITE_URL=https://staging.example.com
LICENSE_KEY=<a separate staging license>
DAILY_LIMIT=20
```

Place a small authorized video containing speech at
`/srv/subtitle-staging/shared/smoke.mp4`; keep it outside release directories.
The test uses Whisper `medium` and real ffmpeg on staging. The first model download
can take several minutes. It consumes one staging quota slot; files expire normally.

Configure host Nginx/TLS from `nginx/subtitle-service.conf`, using the staging
hostname and upstream `127.0.0.1:8081`. It must overwrite X-Real-IP. The inner
allowlist covers loopback/default Docker 172.16.0.0/12; adjust for custom networks.
Do not expose the inner gateway/web/media/database directly to the internet.

In GitHub create environment `staging` (optionally restrict branches/reviewers):

| Setting | Type | Value |
| --- | --- | --- |
| STAGING_HOST | Secret | SSH hostname, without protocol |
| STAGING_USER | Secret | Dedicated deployment user |
| STAGING_SSH_KEY | Secret | Its private SSH key |
| STAGING_KNOWN_HOSTS | Secret | Pinned host-key entry verified outside CI |
| STAGING_ROOT | Variable | `/srv/subtitle-staging` |

No credentials or server were supplied during this PR. The workflow has not been
executed against the user's staging host; that acceptance gate remains open.

## Deploy and acceptance

Merge prerequisites #6 and #7, then this PR. Run **Staging deployment**, choose the
approved branch/tag and `operation=deploy`. The workflow transfers exactly its
commit SHA, builds release-tagged images, starts services, recreates Nginx after
upstream changes, and runs `scripts/staging-smoke.mjs` against the HTTPS hostname.
It checks: upload → transcription → session → authorized video seeking → edit →
render → versioned SRT/video downloads, plus denial of anonymous file access.
A failure leaves the run red; it does not declare the release successful.

For a manual rerun (Node 22+):

```sh
SMOKE_BASE_URL=https://staging.example.com \
SMOKE_VIDEO=/srv/subtitle-staging/shared/smoke.mp4 \
node scripts/staging-smoke.mjs
```

Before production, also confirm browser EN/UK upload/editor, refresh/recovery,
explicit cancellation, two-browser isolation, and worker survival after web restart
on the actual server. Back up DB and media, drain pre-ownership sessions, set the
production secrets and use the Next.js Compose stack from `nextjs-development.md`.
Switch the existing TLS proxy only after staging passes. This PR does not deploy
production or change its Nginx configuration.

## Rollback

Each successful staging deployment updates `current` and retains the prior verified
release as `previous`. Before activating a new release, `previous` points to the
last verified build, so it is available even if the new smoke fails. Run the manual
workflow with `operation=rollback`, or:

```sh
bash /srv/subtitle-staging/current/scripts/staging-release.sh \
  rollback /srv/subtitle-staging
```

The rollback reuses already-built images and recreates the gateway. Database,
uploads and model volumes are retained; the additive schema is not downgraded.
The first-ever deployment has no prior verified build: fix forward or stop only
the staging project. Keep release directories/images for rollback; never run
`docker compose down -v` or prune these images as part of a release.
A worker restart may fail an active render explicitly; its saved SRT can be retried.
Rollback to a pre-ownership public-files build requires a separate maintenance
plan and is deliberately excluded.
