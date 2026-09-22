'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const cfg = require('./config');
const log = require('./logger');
const { upload } = require('./upload');
const queue = require('./queue');
const sessions = require('./sessions');
const { startCleanupScheduler, stopCleanupScheduler } = require('./cleanup');
const { killCurrent } = require('./processor');
const { getDurationSec } = require('./probe');
const ratelimit = require('./ratelimit');
const license = require('./license');

const app = express();
const server = http.createServer(app);

// ---------------------------------------------------------------------------
// WebSocket: /ws?jobId=...
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

// jobId -> job. Filled by /upload and /apply, cleared when the WS attaches
// or on timeout (client never connected).
const pendingJobs = new Map();
const PENDING_TTL_MS = 30_000;

function registerPendingJob(job) {
  job._pendingTimer = setTimeout(() => {
    if (pendingJobs.delete(job.jobId)) {
      log.warn('server', `Job ${job.jobId}: no WS within ${PENDING_TTL_MS / 1000}s — removing from queue`);
      queue.removeByJobId(job.jobId);
    }
  }, PENDING_TTL_MS);
  job._pendingTimer.unref();
  pendingJobs.set(job.jobId, job);
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let jobId = null;
  try {
    const url = new URL(req.url, 'http://localhost');
    jobId = url.searchParams.get('jobId');
  } catch { /* ignore */ }

  if (!jobId) {
    ws.close(4000, 'Missing jobId');
    return;
  }

  const job = pendingJobs.get(jobId);
  if (!job) {
    ws.close(4001, 'Unknown or expired jobId');
    return;
  }

  pendingJobs.delete(jobId);
  clearTimeout(job._pendingTimer);
  job.ws = ws;

  log.info('ws', `Client attached to job ${jobId} [${job.stage}]`);
  queue.notifyJob(job);

  ws.on('close', () => {
    log.info('ws', `Client detached from job ${jobId}`);
    queue.removeBySocket(ws);
  });

  ws.on('error', err => log.warn('ws', `WS error (${jobId}): ${err.message}`));
});

// Heartbeat: terminate dead connections (important behind a reverse proxy)
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
heartbeat.unref();

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: `${cfg.MAX_SRT_SIZE_KB}kb` }));

// Compatibility for the backend-only deployment; the Next gateway redirects to /seo.
app.get('/ceo.html', (_req, res) => res.redirect(308, '/seo.html'));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Original videos for the player. express.static supports HTTP Range —
// that's what makes seeking/scrubbing in the <video> element work.
app.use('/videos', express.static(cfg.UPLOAD_DIR, { index: false }));

// Generated .srt files and final subtitled videos
app.use('/outputs', express.static(cfg.OUTPUT_DIR, { index: false }));

// Legal identity for Impressum / Datenschutz pages (single source of truth)
app.get('/legal', (_req, res) => {
  res.json({
    legal: cfg.LEGAL,
    tgContact: cfg.TG_CONTACT,
    retentionHours: cfg.FILE_TTL_MS / 3600000,
    dailyLimit: cfg.DAILY_LIMIT,
    licenseTtlDays: cfg.LICENSE_TTL_DAYS
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ...queue.getQueueSnapshot() });
});

// Options for the UI (single source of truth: config.js)
app.get('/options', (_req, res) => {
  res.json({
    models: cfg.MODELS,
    languages: cfg.LANGUAGES.map(l => ({ label: l.label, value: l.value, code: l.code })),
    maxFileSizeMb: cfg.MAX_FILE_SIZE_MB,
    allowedExtensions: cfg.ALLOWED_EXTENSIONS,
    support: cfg.SUPPORT_URL
      ? { url: cfg.SUPPORT_URL, name: cfg.SUPPORT_LINK_NAME }
      : null,
    maxDurationSec: cfg.MAX_VIDEO_DURATION_SEC,
    dailyLimit: cfg.DAILY_LIMIT,
    tgContact: cfg.TG_CONTACT
  });
});

// ---------------------------------------------------------------------------
// License
// ---------------------------------------------------------------------------
app.get('/license/status', (req, res) => {
  const active = license.hasValidLicense(req);
  res.json({
    active,
    remaining: active ? null : ratelimit.remaining(req.ip),
    dailyLimit: cfg.DAILY_LIMIT,
    tgContact: cfg.TG_CONTACT
  });
});

app.post('/license', (req, res) => {
  const key = String((req.body && req.body.key) || '').trim();
  if (!license.isValidKey(key)) {
    log.warn('license', `Invalid license key attempt from ${req.ip}`);
    return res.status(400).json({ error: 'Invalid license key.', tgContact: cfg.TG_CONTACT });
  }
  license.setLicenseCookie(res, key);
  log.info('license', `License activated for ${req.ip}`);
  res.json({ ok: true, ttlDays: cfg.LICENSE_TTL_DAYS });
});

// ---------------------------------------------------------------------------
// Stage 1: upload video -> transcribe with Whisper
// ---------------------------------------------------------------------------
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received.' });
  }
  const cleanupAndFail = (code, payload) => {
    fs.unlink(req.file.path, () => {});
    res.status(code).json(payload);
  };

  const language = String(req.body.language || '');
  const model = String(req.body.model || '');

  const langOk = cfg.LANGUAGES.some(l => l.value === language);
  const modelOk = cfg.MODELS.includes(model);
  if (!langOk || !modelOk) {
    const what = !langOk ? `language "${language}"` : `model "${model}"`;
    return cleanupAndFail(400, { error: `Invalid ${what}.` });
  }

  // --- Daily rate limit (skipped for licensed users) ----------------------
  const licensed = license.hasValidLicense(req);
  if (!licensed && ratelimit.remaining(req.ip) <= 0) {
    log.warn('upload', `Rate limit hit for ${req.ip}`);
    return cleanupAndFail(429, {
      error: `Daily limit reached (${cfg.DAILY_LIMIT} translations per day). ` +
             `Enter a license key for unlimited use — to obtain one, contact ${cfg.TG_CONTACT} on Telegram.`,
      limitReached: true,
      tgContact: cfg.TG_CONTACT
    });
  }

  // --- Duration limit (also rejects files ffprobe can't read) -------------
  let durationSec;
  try {
    durationSec = await getDurationSec(req.file.path);
  } catch (err) {
    return cleanupAndFail(400, { error: err.message });
  }
  if (durationSec > cfg.MAX_VIDEO_DURATION_SEC) {
    const maxMin = Math.round(cfg.MAX_VIDEO_DURATION_SEC / 60);
    return cleanupAndFail(400, {
      error: `Video is ${(durationSec / 60).toFixed(1)} min long — the maximum is ${maxMin} minutes.`
    });
  }

  // Consume the daily slot only after all validation passed
  if (!licensed) ratelimit.consume(req.ip);

  const jobId = uuidv4();
  const base = path.parse(req.file.filename).name;

  // Oversized files get compressed first (inside the same queued job)
  const needsCompress = req.file.size > cfg.COMPRESS_THRESHOLD_MB * 1024 * 1024;

  const job = {
    jobId,
    sessionId: jobId, // the upload jobId doubles as the edit-session id
    stage: 'transcribe',
    ws: null,
    videoPath: req.file.path,
    needsCompress,
    compressedPath: needsCompress ? path.join(cfg.UPLOAD_DIR, `${base}_c.mp4`) : null,
    srtPath: path.join(cfg.OUTPUT_DIR, `${base}.srt`),
    outputPath: null,
    language,
    model,
    uploadedAt: Date.now(),
    status: 'queued'
  };

  registerPendingJob(job);
  queue.enqueue(job);

  log.info('upload', `Accepted job ${jobId}: ${req.file.originalname} ` +
    `(${(req.file.size / 1048576).toFixed(1)} MB, ${durationSec.toFixed(0)}s, ${language}, ${model}` +
    `${needsCompress ? ', will compress' : ''}${licensed ? ', licensed' : ''})`);
  res.json({ jobId });
});

// ---------------------------------------------------------------------------
// Stage 2: apply (possibly edited) subtitles -> burn into the video
// Body: { jobId: <sessionId from stage 1>, srt: "<full srt text>" }
// ---------------------------------------------------------------------------
app.post('/apply', (req, res) => {
  const sessionId = String((req.body && req.body.jobId) || '');
  const srt = req.body && req.body.srt;

  if (!sessionId || typeof srt !== 'string' || srt.trim().length === 0) {
    return res.status(400).json({ error: 'jobId and non-empty srt are required.' });
  }

  const session = sessions.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired. Please upload the video again.' });
  }

  // Check before writing SRT. This handler is synchronous through enqueue,
  // so concurrent HTTP requests cannot both reserve this session.
  if (queue.hasActiveBurn(sessionId)) {
    return res.status(409).json({ error: 'This session already has a queued or running render.' });
  }

  // Persist the edited subtitles (overwrites whisper output — the session
  // always holds the latest version, so re-editing works)
  try {
    fs.writeFileSync(session.srtPath, srt, 'utf8');
  } catch (err) {
    log.error('apply', `Failed to write srt: ${err.message}`);
    return res.status(500).json({ error: 'Failed to save subtitles.' });
  }

  const burnJobId = uuidv4();
  const base = path.parse(session.videoPath).name;

  const job = {
    jobId: burnJobId,
    sessionId,
    stage: 'burn',
    ws: null,
    videoPath: session.videoPath,
    srtPath: session.srtPath,
    // Always .mp4 — burn.sh re-encodes to H.264/AAC so the result plays everywhere
    outputPath: path.join(cfg.OUTPUT_DIR, `${base}_${burnJobId}_subtitled.mp4`),
    language: null,
    model: null,
    uploadedAt: Date.now(),
    status: 'queued'
  };

  registerPendingJob(job);
  queue.enqueue(job);

  log.info('apply', `Session ${sessionId}: burn job ${burnJobId} queued (${srt.length} bytes of srt)`);
  res.json({ jobId: burnJobId });
});

// Fetch current subtitles for a session (used when re-opening the editor)
app.get('/srt/:sessionId', (req, res) => {
  const session = sessions.getSession(String(req.params.sessionId));
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }
  res.type('text/plain').send(fs.readFileSync(session.srtPath, 'utf8'));
});

// Error handler (multer, JSON body too large, etc.)
app.use((err, _req, res, _next) => {
  log.error('http', err.message);
  const code = err.name === 'MulterError' || err.type === 'entity.too.large' ? 413 : 400;
  res.status(code).json({ error: err.message });
});

// ---------------------------------------------------------------------------
// Boot + graceful shutdown
// ---------------------------------------------------------------------------
startCleanupScheduler();
sessions.startSessionSweeper();
ratelimit.startRateLimitSweeper();

server.listen(cfg.PORT, cfg.HOST, () => {
  log.info('server', `Service listening on ${cfg.HOST}:${cfg.PORT}`);
  log.info('server', `Upload dir: ${cfg.UPLOAD_DIR}`);
});

function shutdown(signal) {
  log.warn('server', `Received ${signal} — shutting down...`);
  queue.shutdown();
  killCurrent();
  stopCleanupScheduler();
  clearInterval(heartbeat);

  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');

  server.close(() => {
    log.info('server', 'Stopped cleanly.');
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
