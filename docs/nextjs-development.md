# Next.js foundation (migration step 2)

`web/` is an independent Next.js App Router + TypeScript application. Its public
landing page links to `/studio`, which serves the React upload form.
Both the upload form and subtitle editor now use React.

## Run the Docker stack

```sh
cp .env.example .env # only if .env does not already exist; fill in your settings
# Keep the same project directory/name to reuse existing uploads and model volumes.
docker compose -f docker-compose.yml -f docker-compose.next.yml up -d --build
```

Open `http://localhost:8080`. This localhost-only port is the unified Nginx entry:

| URL | Service |
| --- | --- |
| `/`, `/uk`, `/seo`, `/uk/seo`, `/impressum`, `/datenschutz`, `/_next/*`, `/api/health` | Next.js web |
| `/studio`, `/uk/studio` | React upload form |
| `/editor?sessionId=...`, `/uk/editor?sessionId=...` | React subtitle editor |
| Legacy `.html` public URLs | Next.js permanent redirects |
| `/upload`, `/apply`, `/options`, `/legal`, `/health`, `/license/*`, `/sessions/*` | Express API |
| `/ws?jobId=...` | Express WebSocket (upgrade + four-hour timeout) |
| `/videos/*`, `/outputs/*`, `/srt/*` | Express media/SRT with Range support |

There is no Next.js upload proxy, Server Action, custom server or background
worker inside the web process. Nginx sends large multipart uploads directly to
Express with request buffering disabled. Relative legacy URLs and cookies stay
same-origin. `/health` checks the media backend; `/api/health` checks the web.
The web image contains neither Whisper nor uploaded files.

For the existing HTTPS host Nginx config, change only the upstream port from
`127.0.0.1:3000` to `127.0.0.1:8080`, then run `nginx -t` and reload. Its existing
upload and WebSocket settings continue to apply. Do this only after a staging
smoke check. After recreating backend/web containers, recreate/restart `gateway`
too so Nginx resolves their current container addresses.

`deploy.sh` still deploys the original stack; use the explicit Compose command
above for this opt-in migration. Rollback: restore the host upstream to port
3000, validate and reload Nginx, then stop `gateway` and `web` using the same
Compose files. Never delete the media volumes during rollback.

## Local development without rebuilding web

```sh
npm install # backend; use npm ci once step 1's lockfile is merged
npm start   # terminal 1, media backend on 3000
cd web
npm ci
npm run dev # terminal 2, Next.js on 3001
```

Use a local Nginx copy of `nginx/next-gateway.conf`, replacing upstream hosts
`subtitle-service:3000` / `web:3001` with `127.0.0.1:3000` /
`127.0.0.1:3001`, and `listen 80` with `listen 8080`. Browse port 8080 for full
integration. Port 3001 alone serves only Next.js; media routes require the gateway.
This avoids development-only rewrites that could accidentally buffer uploads.

## Checks

```sh
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run build
```

With Nginx and backend dependencies installed, `node web/scripts/gateway-smoke.mjs`
starts temporary Next.js, media and gateway processes and checks real HTTP/WS
routing (including a 2 MB upload, cookies and HTTP Range) using stub media commands.

GitHub Actions also runs this smoke test, builds the standalone web Docker image and validates merged
Compose configuration. `npm ci` uses the committed web lockfile. Node 22+ is used
for the web application; the existing media runtime is unchanged.

Before switching the HTTPS proxy, verify through the gateway: landing and assets,
React editor, options, license activation/cookie, a small upload, WebSocket
status, video seeking (206 Range response), SRT/MP4 download and repeat rendering
(after step 1 is merged). A first real Whisper run may download its model.

## Public pages (step 3)

Next.js serves `/` and `/uk` (English/Ukrainian home), `/seo` and `/uk/seo`
(public subtitle guide), and German `/impressum` and `/datenschutz`.
Shared layouts render the correct document language, navigation and footer.
The React upload form is on `/studio` and `/uk/studio`; the React editor is on `/editor` and `/uk/editor`.
A validated `?lang=en|uk` preserves the selected language on entry to the editor;
the Ukrainian editor uses `/uk/editor`.

Old public URLs use permanent 308 redirects: `/index.html` → `/`,
`/impressum.html` → `/impressum`, `/datenschutz.html` → `/datenschutz`, and
both `/ceo.html` and `/seo.html` → `/seo`. The original CEO/internal brief is
removed and replaced by factual public SEO content. The backend-only deployment
retains its legal HTML pages and a new `public/seo.html`, with a compatibility
redirect from `/ceo.html`.

Runtime settings for web:

- `MEDIA_API_URL`: internal backend origin; Compose sets `http://subtitle-service:3000`.
  Local default is `http://127.0.0.1:3000`. Pages request only `/legal` and `/options`,
  server-side, without caching, so operator details and limits are not frozen at build.
- `SITE_URL`: real public origin, e.g. `https://your.domain.com`, set in root `.env`.
  This supplies canonical/hreflang/Open Graph URLs and sitemap entries at runtime.
  If unset, absolute canonical links and sitemap entries are omitted rather than
  advertising a guessed domain. Recreate web after changing environment settings.

`/robots.txt` and `/sitemap.xml` expose public pages and exclude media paths from
crawling. Robots directives are not access controls. The new pages use system
fonts throughout, including the editor. Existing German legal wording
is migrated, not independently legally reviewed; operator placeholders continue
to come from the backend configuration.


## React upload (step 4)

`/studio` (EN) and `/uk/studio` (UK) fetch `/options` and `/license/status` on the
client. `/studio?lang=uk` redirects for compatibility with old landing links.
The form supports file selection/drop, configured extension/size limits,
source-language/model preference cookies, license activation, upload progress,
queue position, compression/transcription status and actionable errors.
Duration and media validation remain authoritative on the backend.

Uploads use XMLHttpRequest/FormData directly through Nginx to Express; no video
is copied into a Next.js request body. WebSocket connections are opened only
from the user-triggered upload flow, and are closed on component unmount.
The existing disconnect-cancels-job behavior remains: no automatic reconnection
or persistent recovery is promised by this step.

On `transcribed`, the browser navigates to the localized `/editor?sessionId=...`.
The React editor loads `/sessions/:sessionId` (no-store) for server-resolved
file basenames, then uses `/srt/:sessionId`. It never re-uploads the video and
reports a missing/expired session. Reset from this editor returns to React.
The backend-only legacy `/` continues working with its existing upload UI.

CI installs Chromium and runs Playwright against the real Nginx/Next/Express
stack in `scripts/gateway-smoke.mjs`. Browser checks cover client validation,
license activation, saved preferences, progress and single submission, queue
stages, HTTP/network/WS errors, unmount cleanup, Ukrainian UI, mobile overflow,
and upload → React editor → edit → render → download with stub media commands.
The root tests also verify the session handoff response and expired-session 404.


## React subtitle editor (step 5)

`/editor` and `/uk/editor` load the session and current SRT client-side with
no-store requests. The old `?lang=uk` entry redirects to `/uk/editor`.
Nginx now routes both editor pages to Next.js; media and rendering remain in Express.
The backend-only legacy UI stays available for rollback through the original stack.

The editor preserves timestamps, supports multiline text, seeks from keyboard-accessible
timestamp buttons and follows the active cue during playback. Unsupported browser
video codecs show a note without preventing editing/rendering. Invalid or empty SRT
fails explicitly instead of silently dropping subtitles. Empty cues and blank lines
inside cues must be corrected before rendering or exporting.

Apply posts the current SRT to `/apply`, then follows the returned burn job over
WebSocket. The session ID remains separate from each burn job ID. Editing is disabled
during rendering, duplicate submissions are blocked and failures retain the draft.
After editing again, the old video download is hidden until the new render succeeds.
SRT downloads contain the current local draft, including before a render. Successful
apply persists SRT on the backend; reload restores that version. Unapplied edits are
in component memory only. Leaving the page aborts requests and closes the socket,
with the existing server cancellation behavior; no reconnect/resume is introduced.

CI tests SRT round trips and invalid input, upload through two real render/download
cycles using stub media commands, reload, local SRT export, playback cue selection,
HTTP/WS errors, duplicate submits, cleanup, malformed SRT retry and Ukrainian/mobile UI.


## Durable state (step 6)

The Next.js Compose stack now includes PostgreSQL 16. Set a unique URL-safe
`POSTGRES_PASSWORD` in `.env`. The `subtitle-db` volume stores sessions, jobs and
UTC daily quotas. Do not delete this volume or the media volume on upgrade.
Schema initialization is additive and serialized with a database advisory lock.
Back up both PostgreSQL and media together. Existing in-memory jobs/sessions cannot
be migrated: drain the old service before switching; old files remain until TTL.

`DATABASE_URL` selects durable mode; without it the backend-only implementation
and its compatibility tests remain available. Do not use multiple legacy instances.
In durable mode, quota consumption and enqueue commit in one transaction. Concurrent
uploads cannot exceed the limit. Cancellation does not refund quota. License cookies
remain the existing model; random session/job IDs remain bearer capabilities.

After an accepted upload, `/task?jobId=...` (or `/uk/task`) polls durable snapshots.
Refresh/closing no longer cancels work. The editor restores saved text and its latest
render job via `/sessions/:id`. Explicit POST `/jobs/:id/cancel` is idempotent.
GET `/jobs/:id` is no-store. Temporary connectivity loss retries automatically.
An HTTP upload interrupted before its acknowledgement is not resumable; this step
persists accepted jobs, not partially uploaded bodies. Unapplied editor drafts
remain local memory, as before.

A dedicated PostgreSQL advisory lock enforces one worker across API replicas.
After taking ownership, the worker marks interrupted processing rows as errors
(or cancelled if requested); queued rows continue. It never blindly repeats an
interrupted heavy task. Python supervises each process group and stops it when
its Node owner exits. Lost DB connections stop processing. Deploy on one media
volume/host; do not independently replicate the filesystem. TTL cleanup protects
queued/running inputs, and deletes expired metadata before orphan files.

CI uses a real PostgreSQL service to test concurrent quota claims, two competing
workers, abrupt process restart, persisted sessions, duplicate renders, explicit
cancellation and retry. Browser checks cover refresh/recovered results.

## Separate API and worker (step 7)

Deploy the same Compose command; it now starts `web`, the upload/media service,
`worker`, PostgreSQL and Nginx. Restarting web or the upload service never owns or
interrupts a worker job. The worker alone runs scripts and retention cleanup,
using the shared database lock to serialize all compression/transcription/burns.
A standby worker cannot process concurrently. Restarting the worker still marks
interrupted processing as failed, as in step 6.

Next.js Node Route Handlers own `/options`, `/legal`, `/license`, `/license/status`,
`/sessions/*`, `/jobs/*`, `/apply`, `/srt/*` and the database readiness `/health`.
They call the shared domain/store directly, not the media HTTP API. Bodies are
streamed with a size bound. Nginx sets the trusted client IP; do not expose the
web container directly to untrusted traffic. The media service handles multipart
`/upload` (including probing), files/Range and optional WS observers. No full video
passes through Next.js. `/api/health` is the web process liveness endpoint.
Without DATABASE_URL only, handlers proxy ordinary operations to the original
backend for compatibility. The durable media process refuses those operations.

Build the web image from the repository root:
`docker build -f web/Dockerfile -t subtitle-web .`.
Standalone output is now `.next/standalone/web/server.js`, with traced shared
modules above it. No media volume is mounted into Next.js: it stores SRT in the
DB and constructs file paths for the worker using the same UPLOAD_DIR.

Transcription creates SRT version 1. Each accepted apply transaction creates a
new immutable SRT version, linked to its queued render. Rejected duplicate applies
create no version. Output names contain the unique render ID; subsequent renders
do not overwrite prior results. `/sessions/:id/versions` lists versions/renders;
`/sessions/:id/versions/:version` downloads an immutable SRT. The editor exposes
history and completed downloads. Failed/cancelled renders retain their SRT version.
Retention removes the entire expired session history and its files. On upgrade
from step 6, only the current SRT can be backfilled as version 1; historical edits
from before versioning cannot be reconstructed.

The PostgreSQL integration test starts actual Next.js, media and two worker
processes, kills/restarts web and media during a render, checks one active heavy
job, worker crash recovery and immutable version/output downloads. Existing
backend-only and browser gateway suites remain regression gates.
