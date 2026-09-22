# Next.js foundation (migration step 2)

`web/` is an independent Next.js App Router + TypeScript application. Its public
landing page links to `/studio`, which still serves the complete existing editor.
The React upload/editor migration is deliberately deferred to later steps.

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
| `/studio` | Existing Express editor |
| Legacy `.html` public URLs | Next.js permanent redirects |
| `/upload`, `/apply`, `/options`, `/legal`, `/health`, `/license/*` | Express API |
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
legacy editor, options, license activation/cookie, a small upload, WebSocket
status, video seeking (206 Range response), SRT/MP4 download and repeat rendering
(after step 1 is merged). A first real Whisper run may download its model.

## Public pages (step 3)

Next.js serves `/` and `/uk` (English/Ukrainian home), `/seo` and `/uk/seo`
(public subtitle guide), and German `/impressum` and `/datenschutz`.
Shared layouts render the correct document language, navigation and footer.
The complete upload/editor remains on `/studio` until steps 4–5.
A validated `?lang=en|uk` preserves the selected language on entry to the editor;
the editor's own language switch remains available.

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
fonts; the legacy editor still loads Google Fonts. Existing German legal wording
is migrated, not independently legally reviewed; operator placeholders continue
to come from the backend configuration.
