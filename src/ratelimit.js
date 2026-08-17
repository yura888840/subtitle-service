'use strict';

const cfg = require('./config');
const log = require('./logger');

/**
 * Daily per-IP transcription limit. In-memory by design (single instance,
 * consistent with the in-memory queue). Resets at UTC midnight; a container
 * restart also resets it — acceptable for an anti-abuse measure.
 *
 * ip -> { day: 'YYYY-MM-DD', count }
 */
const buckets = new Map();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getBucket(ip) {
  const day = today();
  let b = buckets.get(ip);
  if (!b || b.day !== day) {
    b = { day, count: 0 };
    buckets.set(ip, b);
  }
  return b;
}

/** How many free transcriptions this IP has left today. */
function remaining(ip) {
  return Math.max(0, cfg.DAILY_LIMIT - getBucket(ip).count);
}

/** Consume one slot. Returns false if the limit is already reached. */
function consume(ip) {
  const b = getBucket(ip);
  if (b.count >= cfg.DAILY_LIMIT) return false;
  b.count++;
  return true;
}

/** Periodic sweep so the map doesn't grow forever. */
function startRateLimitSweeper() {
  const t = setInterval(() => {
    const day = today();
    let removed = 0;
    for (const [ip, b] of buckets.entries()) {
      if (b.day !== day) { buckets.delete(ip); removed++; }
    }
    if (removed) log.info('ratelimit', `Swept ${removed} stale IP bucket(s)`);
  }, 60 * 60 * 1000);
  t.unref();
}

module.exports = { remaining, consume, startRateLimitSweeper };
