# Video Subtitle Service

Upload a video → Whisper generates English subtitles → **review and edit them next to a video player** → burn the (edited) subtitles into the video with ffmpeg → download the result.

Single-worker queue: one heavy job (transcription *or* burning) runs at a time; everyone else waits in line with a live position. Closing the tab while queued removes the job. All files are deleted after 24 hours.

## The two-stage workflow

```
┌─────────┐   whisper    ┌────────────────────┐   ffmpeg    ┌──────────┐
│ Upload  │ ───────────► │ Edit subtitles in  │ ──────────► │ Download │
│ + opts  │  (stage 1)   │ browser w/ player  │  (stage 2)  │  video   │
└─────────┘              └────────────────────┘             └──────────┘
             queue                 no queue —                  queue
                                take your time
```

**Stage 1 — transcribe** (`scripts/transcribe.sh`):
```bash
whisper "$TMP" --task translate --language "$LANGUAGE" --model "$MODEL" \
  --device cpu --output_format srt --output_dir "$SRT_DIR"
```

**Stage 2 — burn** (`scripts/burn.sh`), runs after the user presses **Apply translation**:
```bash
ffmpeg -y -i "$TMP" -vf "subtitles='$SRT_FILE'" -c:a copy "$OUTPUT"
```

Between the stages the user edits subtitles in the browser: the original video plays in a `<video>` element (with seeking — the server supports HTTP Range), each subtitle segment is an editable text area, clicking a timestamp jumps the video to that moment, and the currently-spoken segment is highlighted and auto-scrolled during playback. After burning, the user can keep editing and press **Apply translation again** — the session lives until the 24 h TTL.

## Project structure

```
subtitle-service/
├── src/
│   ├── server.js      # HTTP + WS, /upload /apply /srt /videos /outputs
│   ├── queue.js       # Single worker, two job stages
│   ├── sessions.js    # Edit sessions between the stages
│   ├── processor.js   # Runs scripts with timeout
│   ├── upload.js      # Multer: .mp4/.avi, size limit
│   ├── cleanup.js     # 24h TTL sweep by file mtime
│   ├── config.js      # All config incl. LANGUAGE / MODEL whitelists
│   └── logger.js
├── public/index.html  # Upload view + player/editor view
├── scripts/
│   ├── transcribe.sh  # Command 1: whisper
│   └── burn.sh        # Command 2: ffmpeg burn-in
├── nginx/subtitle-service.conf
├── Dockerfile         # node + ffmpeg + libass fonts + CPU PyTorch + whisper
├── docker-compose.yml
├── deploy.sh
└── .env.example
```

## Quick start

```bash
chmod +x deploy.sh
./deploy.sh
```

Then wire up the reverse proxy:

```bash
sudo cp nginx/subtitle-service.conf /etc/nginx/sites-available/subtitle-service
# edit server_name and certificate paths
sudo ln -s /etc/nginx/sites-available/subtitle-service /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.domain.com
```

**First job per model downloads that model** (`large-v3` ≈ 3 GB) into the `whisper-models` volume; later jobs reuse it. To bake models into the image, uncomment the marked lines in the `Dockerfile`.

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | UI |
| `GET` | `/options` | Models, languages, limits |
| `POST` | `/upload` | Multipart: `video`, `language`, `model` → `{ jobId }` (jobId = session id) |
| `WS` | `/ws?jobId=...` | Status stream for a queued/processing job |
| `GET` | `/videos/:file` | Original video (Range supported → player seeking works) |
| `GET` | `/srt/:sessionId` | Current subtitles for a session |
| `POST` | `/apply` | JSON `{ jobId, srt }` → queues the burn → `{ jobId: burnJobId }` |
| `GET` | `/outputs/:file` | Download `.srt` or the final subtitled video |
| `GET` | `/health` | Health + queue snapshot |

### WebSocket messages (server → client)

```json
{ "status": "queued",      "stage": "transcribe|burn", "position": 2 }
{ "status": "processing",  "stage": "transcribe|burn" }
{ "status": "transcribed", "sessionId": "...", "videoFile": "...", "srtFile": "..." }
{ "status": "done",        "outputFile": "abc_subtitled.mp4" }
{ "status": "error",       "stage": "...", "message": "..." }
```

## Behaviour rules

- **One heavy job at a time** — transcriptions and burns share the same worker slot.
- **The uploaded video is kept** after transcription (needed for playback and burning); everything is removed by the 24 h TTL sweep.
- **Editing needs no connection** — the editor phase has no WebSocket, so you can take an hour; nothing gets cancelled while you edit. Sessions are validated against files on disk, so an expired TTL invalidates the session cleanly.
- **Closing the page cancels your job — including one already processing.** A queued job is simply removed. A job mid-transcription or mid-burn gets its **entire process tree killed** (bash + whisper/ffmpeg children, via a detached process group) — no CPU is wasted on a result nobody will collect. Cleanup on cancel: transcribe → video and partial `.srt` deleted; burn → partial output deleted, video/`.srt` kept until TTL.
- **Disconnect while queued**: transcribe job → video deleted; burn job → removed from queue but files kept.
- **Failed burn** keeps the session — fix the subtitles and apply again.
- **Re-apply** any number of times; each apply overwrites the session's `.srt` with your latest edits.
- **`.avi` preview**: browsers generally can't play AVI natively. The editor shows a notice; editing and burning still work fine.
- **Restart** clears the queue and sessions (in-memory by design); files and models survive on volumes.

## Limits, rate limiting & licensing

- **Max video duration: 7 minutes** (`MAX_VIDEO_DURATION_SEC=420`). Checked with `ffprobe` at upload time; longer videos are rejected instantly with a clear message. Corrupt/non-video files are rejected by the same check.
- **Oversized files are auto-compressed**: uploads larger than `COMPRESS_THRESHOLD_MB` (15) are transcoded down to `COMPRESS_TARGET_MB` (14) before transcription — max 480p, computed video bitrate from the known duration, 64 kbps AAC audio, mp4 container. The compressed file **replaces the original** for playback, editing, and burning (side benefit: `.avi` uploads become browser-playable). Compression runs inside the same queued worker slot, with its own "Compressing video…" status.
- **Free tier: 3 translations per IP per day** (`DAILY_LIMIT`). Counted per successful upload; re-editing and re-applying subtitles is free. The counter is in-memory and resets at UTC midnight (and on restart).
- **License key removes the limit.** The key is validated with a constant-time comparison and stored in an **httpOnly cookie for 7 days** (`LICENSE_TTL_DAYS`). Default key (change it in `.env` before going live!): `SUBS-7K2M-X9QF-4T8B-WL3D`. To obtain a key users are directed to **@it_link_a** on Telegram (`TG_CONTACT`) — shown in the license box on the page and in the limit-reached error.

**Preference cookies**: the last-used *Language of video* and *Model* selections are stored in plain cookies (`pref_language`, `pref_model`, 180-day TTL) and restored on the next visit or page reload. Restored values are validated against the current option lists, so removing a language/model from `config.js` simply falls back to defaults — no broken state.

License endpoints: `GET /license/status` → `{ active, remaining, dailyLimit, tgContact }`; `POST /license { key }` → sets the cookie or 400.

## Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `MAX_FILE_SIZE_MB` | `2048` | Max upload size |
| `MAX_SRT_SIZE_KB` | `2048` | Max edited-SRT payload for /apply |
| `FILE_TTL_HOURS` | `24` | Retention for video, srt, output |
| `CLEANUP_INTERVAL_MIN` | `60` | Cleanup frequency |
| `SCRIPT_TIMEOUT_MS` | `14400000` | Per-job limit (4 h), both stages |
| `TRANSCRIBE_SCRIPT` / `BURN_SCRIPT` | `/app/scripts/...` | Script paths |
| `SUPPORT_URL` | *(empty)* | Donation link (e.g. Buy Me a Coffee) shown on the final screen; empty = block hidden |
| `SUPPORT_LINK_NAME` | `Buy me a coffee` | Text of the donation link |
| `MAX_VIDEO_DURATION_SEC` | `420` | Max video length (7 min) |
| `COMPRESS_THRESHOLD_MB` | `15` | Files above this are compressed first |
| `COMPRESS_TARGET_MB` | `14` | Compression target size |
| `DAILY_LIMIT` | `3` | Free translations per IP per day |
| `LICENSE_KEY` | `SUBS-7K2M-...` | Key that lifts the limit — **change it!** |
| `LICENSE_TTL_DAYS` | `7` | License cookie lifetime |
| `TG_CONTACT` | `@it_link_a` | Telegram contact for obtaining a key |

Keep nginx `client_max_body_size` ≥ `MAX_FILE_SIZE_MB` and the `/ws` `proxy_read_timeout` ≥ `SCRIPT_TIMEOUT_MS`.

## Hardware guidance

| Model | RAM | Rough speed (4 CPU cores) |
|---|---|---|
| `medium` | ~6 GB | ~1–2× video duration |
| `large` / `large-v3` | ~10 GB | ~3–5× video duration |

Burning re-encodes video (subtitle filter forces it) — expect roughly real-time on 4 cores. With an NVIDIA GPU: switch `--device cpu` → `cuda` in `transcribe.sh`, install the CUDA torch wheel, add the nvidia runtime to compose.

## Operations

```bash
docker compose logs -f
docker compose ps
./deploy.sh                        # rebuild + restart
curl http://127.0.0.1:3000/health
```

## Deliberately not included

- Authentication (add `auth_basic` in nginx if needed).
- Database — in-memory queue/sessions are the right call for one worker.
- Editing subtitle *timings* in the UI — only text is editable. Timings from Whisper are usually good; add if users ask.
