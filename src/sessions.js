'use strict';

const fs = require('fs');
const cfg = require('./config');
const log = require('./logger');

/**
 * Session: a transcribed video waiting for (or between) subtitle edits.
 * sessionId (= original upload jobId) -> { videoPath, srtPath, createdAt }
 *
 * Lives in memory; files live on disk under the 24h TTL. A container restart
 * drops sessions — consistent with the in-memory queue design.
 */
const sessions = new Map();

function createSession(sessionId, videoPath, srtPath) {
  sessions.set(sessionId, { videoPath, srtPath, createdAt: Date.now() });
  log.info('sessions', `Session ${sessionId} created (${sessions.size} active)`);
}

function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  // A session is only valid while its files still exist (TTL may have removed them)
  if (Date.now() - s.createdAt > cfg.FILE_TTL_MS || !fs.existsSync(s.videoPath) || !fs.existsSync(s.srtPath)) {
    sessions.delete(sessionId);
    return null;
  }
  return s;
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

/** Drop sessions past TTL (files are removed by cleanup.js independently). */
function sweepSessions() {
  const now = Date.now();
  let removed = 0;
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > cfg.FILE_TTL_MS) {
      sessions.delete(id);
      removed++;
    }
  }
  if (removed > 0) log.info('sessions', `Swept ${removed} expired session(s)`);
}

function startSessionSweeper() {
  const t = setInterval(sweepSessions, cfg.CLEANUP_INTERVAL_MS);
  t.unref();
}

module.exports = { createSession, getSession, deleteSession, startSessionSweeper, sweepSessions };
