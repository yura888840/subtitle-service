# Baseline HTTP and job contract

This is the compatibility contract for the incremental Next.js migration.
The media backend remains a single Node process; sessions, pending handshakes,
quotas and the queue are in memory. Restarting loses that state.

## HTTP

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/options` | Models, source languages, allowed extensions, limits and support configuration |
| GET | `/legal` | Operator/contact information and retention configuration |
| GET | `/health` | `{ status, workerBusy, length, jobs }`; diagnostic queue snapshot |
| GET | `/license/status` | `{ active, remaining, dailyLimit, tgContact }` |
| POST | `/license` | JSON `{ key }`; 200 and license cookie, or 400 |
| POST | `/upload` | Multipart `video`, `language`, `model`; 200 `{ jobId }` (also the session ID) |
| GET | `/srt/:sessionId` | Current editable SRT; 404 if session expired or files disappeared |
| POST | `/apply` | JSON `{ jobId: sessionId, srt }`; 200 `{ jobId: burnJobId }` |
| GET | `/videos/:file` | Uploaded/processed source; HTTP Range supported |
| GET | `/outputs/:file` | SRT or rendered MP4; HTTP Range supported |

Upload rejects missing/invalid input or unreadable/overlong media (400), oversized
files (413), and exhausted free quotas (429). Defaults: 300 MB, seven minutes,
three free uploads per IP per UTC day. Source language and model are allowlisted.
Whisper runs `--task translate`: output subtitles are English.

Apply rejects missing/empty input (400), missing/expired sessions (404), a render
already queued/running for that session (409), or an SRT write failure (500).
The 409 check happens **before** any subtitle write. It prevents simultaneous
renders; it is not a durable idempotency-key API. A request after completion is
an intentional new render. SRT syntax validation is not yet implemented.

Every accepted render has a unique output filename. A later failed/cancelled
render cannot overwrite or remove a previously downloaded result. Successful
renders keep the video, editable SRT and session, allowing another apply.
The shared SRT download always represents the latest accepted edit.

## WebSocket and states

Connect to `/ws?jobId=...` within 30 seconds after upload/apply. One connection
may attach per job. Missing/unknown IDs close with codes 4000/4001.

- `queued`: `{ status, stage, position }`, with 1-based waiting position.
- `processing`: `{ status, stage }`, stage is `compress`, `transcribe` or `burn`.
- `transcribed`: `{ status, sessionId, videoFile, srtFile }`; open the editor.
- `done`: `{ status, outputFile }`; download the MP4.
- `error`: `{ status, stage?, message }`; processing or service restart failure.

A terminal result completed before attachment is replayed within the handshake
window. At most one heavy task runs at a time. A disconnected queued task is
removed; a disconnected running task is killed. A cancelled burn keeps its
session for retry and removes only its partial output. Refresh/reconnection and
persistent jobs are future migration work, not guarantees of this baseline.

## Retention and remaining limitations

Sessions expire 24 hours after transcription by default. Files are swept by their
individual modification times, so this is not an exact upload-based expiry for
all artifacts. Re-editing does not renew session expiry. A missing source or SRT
invalidates the session. Cleanup still needs active-job protection in a later
worker migration. File URLs are bearer-like unguessable paths, not authenticated
owner checks. Current compression replaces the original video; preserving the
original is separate work.

## Verification

`npm ci && npm test` runs isolated real HTTP/WebSocket integration tests with
stub ffprobe/transcription/burn commands: edit/render/download/re-render, Range,
queued/running conflicts, cancellation, failure/retry and late WS attachment.
Stub output is deliberately not an actual MP4. Before deploying media changes,
repeat upload → edit → render → download → re-edit on a real short video, check
playback/audio/subtitles, and verify both old and new rendered outputs.
