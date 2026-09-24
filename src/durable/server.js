'use strict';
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
const cfg = require('../config');
const log = require('../logger');
const { upload } = require('./upload');
const { getDurationSec } = require('../probe');
const license = require('../license');
const store = require('./store');
const { dispatch } = require('./api');
const ownership = require('./ownership');

const app = express();
app.disable('x-powered-by');
// Trust only the local gateway, not arbitrary client forwarding chains.
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Cross-origin request denied.' });
  next();
});
app.use(express.json({ limit: `${cfg.MAX_SRT_SIZE_KB}kb` }));
for (const kind of ['videos', 'outputs']) {
  app.get(`/${kind}/:file`, async (req, res) => {
    try {
      const file = await store.fileAccess(kind, req.params.file, ownership.owner(req.headers.cookie));
      res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.sendFile(file, { cacheControl: false }, err => {
        if (err && !res.headersSent) res.status(404).json({ error: 'File not found.' });
      });
    } catch (err) { res.status(err.status || 503).json({ error: err.status ? err.message : 'Service temporarily unavailable.' }); }
  });
}
app.post('/upload', (req, res, next) => {
  try {
    const identity = ownership.issue(req.headers.cookie); req.owner = identity.id;
    if (identity.cookie) res.set('Set-Cookie', identity.cookie);
    next();
  } catch (err) { next(err); }
}, upload.single('video'), async (req, res) => {
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

  const licensed = license.hasValidLicense(req);

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

  try {
    if (req.aborted) return cleanupAndFail(400, { error: 'Upload interrupted.' });
    await store.accept(job, req.ip, licensed, req.owner);
  } catch (err) { return cleanupAndFail(err.status || 503, { error: err.status ? err.message : 'Database unavailable. Try again.' }); }

  log.info('upload', `Accepted job ${jobId}: ${req.file.originalname} ` +
    `(${(req.file.size / 1048576).toFixed(1)} MB, ${durationSec.toFixed(0)}s, ${language}, ${model}` +
    `${needsCompress ? ', will compress' : ''}${licensed ? ', licensed' : ''})`);
  res.json({ jobId, durable: true });
});


app.use(async (req, res) => {
  try {
    if (req.path !== '/health') return res.status(404).json({ error: 'Use the Next.js gateway for this API.' });
    const result = await dispatch(req.method, req.path, { body: req.body, ip: req.ip, cookie: req.headers.cookie });
    res.set(result.headers).status(result.status).send(result.body);
  } catch (err) { res.status(err.status || 503).json({ error: err.status ? err.message : 'Service temporarily unavailable.' }); }
});
app.use((err, _req, res, _next) => res.status(err.name === 'MulterError' || err.type === 'entity.too.large' ? 413 : 400).json({ error: err.message }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const id = new URL(req.url, 'http://localhost').searchParams.get('jobId') || '';
  let pending = false;
  const poll = async () => {
    if (pending || ws.readyState !== 1) return;
    pending = true;
    try { const snapshot = await store.getJob(id, ownership.owner(req.headers.cookie)); if (ws.readyState === 1) ws.send(JSON.stringify(snapshot)); }
    catch (err) { if (err.status === 404) ws.close(4001, 'Unknown job'); }
    finally { pending = false; }
  };
  const timer = setInterval(poll, 1000); void poll();
  ws.on('close', () => clearInterval(timer)); // Observers never own job lifetime.
  ws.on('error', () => {});
});
async function main() {
  ownership.validate();
  await store.migrate();

  server.listen(cfg.PORT, cfg.HOST);
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
    for (const ws of wss.clients) ws.close(1001, 'Restarting');
    server.close();
    await store.pool.end(); process.exit(0);
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch(err => { console.error(err); process.exit(1); });
