'use strict';

const path = require('path');
const { runScript, cancelCurrent } = require('./processor');
const { deleteFile } = require('./cleanup');
const { createSession } = require('./sessions');
const cfg = require('./config');
const log = require('./logger');

/**
 * Job:
 * {
 *   jobId:      string (uuid) — WS handshake id
 *   sessionId:  string — edit-session id (= original upload jobId)
 *   stage:      'transcribe' | 'burn'
 *   ws:         WebSocket | null
 *   videoPath:  string — original uploaded video
 *   srtPath:    string — subtitle file (whisper output / user-edited)
 *   outputPath: string | null — final subtitled video (burn stage only)
 *   language:   string | null (transcribe stage only, whitelisted)
 *   model:      string | null (transcribe stage only, whitelisted)
 *   uploadedAt: number (ms)
 *   status:     'queued' | 'processing' | 'done' | 'error'
 *   cancelled:  boolean — client left, job was killed mid-processing
 * }
 */
const queue = [];
let workerBusy = false;
let currentJob = null; // the job currently being processed
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function enqueue(job) {
  job.cancelled = false;
  queue.push(job);
  log.info('queue', `Job ${job.jobId} queued [${job.stage}] (position ${queuedPosition(job)})`);
  notifyPositions();
  maybeProcessNext();
}

/**
 * Client closed the tab.
 * - Queued job: remove from queue.
 * - Currently PROCESSING job: kill the running whisper/ffmpeg —
 *   nobody is waiting for the result, don't burn CPU for hours.
 */
function removeBySocket(ws) {
  if (!ws) return;

  // Case 1: the disconnecting client owns the job being processed right now
  if (currentJob && currentJob.ws === ws && currentJob.status === 'processing') {
    cancelProcessing(currentJob, 'client disconnected');
    return;
  }

  // Case 2: a queued job
  const idx = queue.findIndex(j => j.ws === ws && j.status === 'queued');
  if (idx === -1) return;
  removeAt(idx, 'client disconnected');
}

/** Remove/cancel by jobId (e.g. client never opened the WebSocket). */
function removeByJobId(jobId) {
  if (currentJob && currentJob.jobId === jobId && currentJob.status === 'processing') {
    cancelProcessing(currentJob, 'WebSocket was never attached');
    return;
  }
  const idx = queue.findIndex(j => j.jobId === jobId && j.status === 'queued');
  if (idx === -1) return;
  removeAt(idx, 'WebSocket was never attached');
}

function cancelProcessing(job, reason) {
  if (job.cancelled) return; // idempotent
  job.cancelled = true;
  log.warn('queue', `Job ${job.jobId} [${job.stage}] cancelled mid-processing — ${reason}. Killing process.`);
  cancelCurrent();
  // File cleanup happens in the runScript rejection handler,
  // which fires once the process tree is confirmed dead.
}

function removeAt(idx, reason) {
  const [job] = queue.splice(idx, 1);
  log.info('queue', `Job ${job.jobId} [${job.stage}] removed — ${reason}.`);
  if (job.stage === 'transcribe') {
    // Nothing useful exists yet — delete the uploaded video
    deleteFile(job.videoPath);
  }
  // burn stage: keep video + srt — files fall under the 24h TTL anyway
  notifyPositions();
}

/** Includes cancelling jobs until their process has actually stopped. */
function hasActiveBurn(sessionId) {
  return queue.some(job => job.stage === 'burn' && job.sessionId === sessionId &&
    (job.status === 'queued' || job.status === 'processing'));
}

function complete(job, payload) {
  // A short job may finish before the browser attaches its WebSocket.
  // pendingJobs retains the job for the existing 30-second handshake window.
  job.result = payload;
  send(job.ws, payload);
}

function getQueueSnapshot() {
  return {
    workerBusy,
    length: queue.length,
    jobs: queue.map(j => ({
      jobId: j.jobId,
      stage: j.stage,
      status: j.status,
      uploadedAt: new Date(j.uploadedAt).toISOString()
    }))
  };
}

function shutdown() {
  shuttingDown = true;
  for (const job of queue) {
    send(job.ws, { status: 'error', message: 'Service is restarting. Please try again.' });
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function maybeProcessNext() {
  if (workerBusy || shuttingDown) return;

  const job = queue.find(j => j.status === 'queued');
  if (!job) return;

  workerBusy = true;
  currentJob = job;
  job.status = 'processing';
  log.info('queue', `Processing job ${job.jobId} [${job.stage}]`);

  let run;
  if (job.stage === 'transcribe') {
    run = (async () => {
      // Optional sub-step: shrink oversized videos first (same worker slot —
      // compression is ffmpeg CPU work and must respect one-job-at-a-time)
      if (job.needsCompress) {
        send(job.ws, { status: 'processing', stage: 'compress' });
        await runScript(cfg.COMPRESS_SCRIPT, [job.videoPath, job.compressedPath, String(cfg.COMPRESS_TARGET_MB)]);
        deleteFile(job.videoPath);          // original is no longer needed
        job.videoPath = job.compressedPath; // compressed file replaces it everywhere
      }
      send(job.ws, { status: 'processing', stage: 'transcribe' });
      await runScript(cfg.TRANSCRIBE_SCRIPT, [job.videoPath, job.srtPath, job.language, job.model]);
    })();
  } else {
    send(job.ws, { status: 'processing', stage: 'burn' });
    run = runScript(cfg.BURN_SCRIPT, [job.videoPath, job.srtPath, job.outputPath]);
  }

  run
    .then(() => {
      job.status = 'done';
      if (job.stage === 'transcribe') {
        createSession(job.sessionId, job.videoPath, job.srtPath);
        complete(job, {
          status: 'transcribed',
          sessionId: job.sessionId,
          videoFile: path.basename(job.videoPath),
          srtFile: path.basename(job.srtPath)
        });
      } else {
        complete(job, { status: 'done', outputFile: path.basename(job.outputPath) });
        // Keep the editable session, video and SRT until normal TTL cleanup.
        // A successful render must not break downloads or a subsequent edit.
      }
      log.info('queue', `Job ${job.jobId} [${job.stage}] done.`);
    })
    .catch(err => {
      job.status = 'error';

      if (err.cancelled || job.cancelled) {
        // User left — no one to notify. Clean up everything this job produced.
        log.info('queue', `Job ${job.jobId} [${job.stage}] cancelled; cleaning up.`);
        if (job.stage === 'transcribe') {
          deleteFile(job.videoPath);
          if (job.compressedPath) deleteFile(job.compressedPath);
          deleteFile(job.srtPath);
        } else {
          deleteFile(job.outputPath); // partial burn output
          // video + srt stay until TTL; session sweeper handles the rest
        }
        return;
      }

      complete(job, { status: 'error', stage: job.stage, message: err.message });
      log.error('queue', `Job ${job.jobId} [${job.stage}] failed: ${err.message}`);
      if (job.stage === 'transcribe') {
        deleteFile(job.videoPath);
        if (job.compressedPath) deleteFile(job.compressedPath);
        deleteFile(job.srtPath);
      } else {
        deleteFile(job.outputPath);
      }
    })
    .finally(() => {
      const idx = queue.indexOf(job);
      if (idx !== -1) queue.splice(idx, 1);

      currentJob = null;
      workerBusy = false;
      notifyPositions();
      setImmediate(maybeProcessNext);
    });
}

function queuedPosition(job) {
  let pos = 0;
  for (const j of queue) {
    if (j.status === 'queued') pos++;
    if (j === job) return pos;
  }
  return pos;
}

function notifyPositions() {
  let pos = 0;
  for (const j of queue) {
    if (j.status !== 'queued') continue;
    pos++;
    send(j.ws, { status: 'queued', stage: j.stage, position: pos });
  }
}

function send(ws, payload) {
  if (ws && ws.readyState === 1 /* OPEN */) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      log.warn('queue', `Failed to send message to client: ${err.message}`);
    }
  }
}

/** Push current status to a specific job (on WS connect). */
function notifyJob(job) {
  if (job.result) {
    send(job.ws, job.result);
  } else if (job.status === 'queued') {
    send(job.ws, { status: 'queued', stage: job.stage, position: queuedPosition(job) });
  } else if (job.status === 'processing') {
    send(job.ws, { status: 'processing', stage: job.stage });
  }
}

module.exports = { hasActiveBurn, enqueue, removeBySocket, removeByJobId, getQueueSnapshot, notifyJob, shutdown };
