'use strict';

const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const log = require('./logger');

/** Safe, idempotent file deletion. */
function deleteFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log.info('cleanup', `Deleted: ${filePath}`);
    }
  } catch (err) {
    log.error('cleanup', `Failed to delete ${filePath}: ${err.message}`);
  }
}

/**
 * Sweep a directory: delete files older than TTL by mtime.
 * Works off DISK state, not process memory — survives container restarts.
 */
function sweepDir(dir) {
  let removed = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    try {
      const { mtimeMs } = fs.statSync(full);
      if (now - mtimeMs > cfg.FILE_TTL_MS) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch (err) {
      log.error('cleanup', `Error handling ${full}: ${err.message}`);
    }
  }
  return removed;
}

function runCleanup() {
  const removed = sweepDir(cfg.UPLOAD_DIR) + sweepDir(cfg.OUTPUT_DIR);
  if (removed > 0) {
    log.info('cleanup', `Removed ${removed} file(s) older than ${cfg.FILE_TTL_MS / 3600000}h`);
  }
}

let timer = null;

function startCleanupScheduler() {
  // First sweep immediately on boot — clear leftovers after restarts
  runCleanup();
  timer = setInterval(runCleanup, cfg.CLEANUP_INTERVAL_MS);
  timer.unref();
  log.info('cleanup', `Scheduler started: every ${cfg.CLEANUP_INTERVAL_MS / 60000} min, TTL ${cfg.FILE_TTL_MS / 3600000}h`);
}

function stopCleanupScheduler() {
  if (timer) clearInterval(timer);
}

module.exports = { deleteFile, startCleanupScheduler, stopCleanupScheduler, runCleanup };
