'use strict';

const { spawn } = require('child_process');
const cfg = require('./config');
const log = require('./logger');

let currentChild = null;
let cancelRequested = false;

/**
 * Kill the whole process group, not just the bash wrapper.
 * The scripts spawn heavy children (whisper/python, ffmpeg) — killing only
 * bash would leave them running and burning CPU.
 */
function killTree(child, signal) {
  if (!child || child.killed) return;
  if (child.supervised) { child.stdin.end(); return; }
  try {
    process.kill(-child.pid, signal); // negative pid = process group
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

/**
 * Runs a processing script with the given args.
 * Success: exit code 0. Failure: any other code, timeout, or cancellation.
 * On cancellation the rejected error has err.cancelled === true.
 */
function runScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    log.info('processor', `Running: ${scriptPath} ${args.map(a => `"${a}"`).join(' ')}`);

    cancelRequested = false;

    // detached: true puts bash + all its children into their own process
    // group, so we can kill the entire tree at once.
    const supervised = !!process.env.DATABASE_URL;
    const child = spawn(supervised ? 'python3' : 'bash', supervised ? [require('path').join(__dirname, '../scripts/supervise.py'), scriptPath, ...args] : [scriptPath, ...args], {
      stdio: [supervised ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: !supervised
    });
    child.supervised = supervised;
    child.stdin?.on('error', () => {});
    currentChild = child;

    let stderrTail = '';
    let timedOut = false;

    let timeout = null;
    if (cfg.SCRIPT_TIMEOUT_MS > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        log.warn('processor', `Timeout after ${cfg.SCRIPT_TIMEOUT_MS} ms — killing process tree`);
        killTree(child, 'SIGKILL');
      }, cfg.SCRIPT_TIMEOUT_MS);
    }

    child.stdout.on('data', d => process.stdout.write(`[script] ${d}`));
    child.stderr.on('data', d => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
      process.stderr.write(`[script] ${d}`);
    });

    child.on('close', code => {
      if (timeout) clearTimeout(timeout);
      currentChild = null;

      if (cancelRequested) {
        const err = new Error('Job cancelled — client disconnected.');
        err.cancelled = true;
        reject(err);
      } else if (timedOut) {
        reject(new Error('Processing exceeded the time limit and was stopped.'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script exited with code ${code}. ${stderrTail.trim()}`));
      }
    });

    child.on('error', err => {
      if (timeout) clearTimeout(timeout);
      currentChild = null;
      reject(new Error(`Failed to start script: ${err.message}`));
    });
  });
}

/**
 * Cancel the currently running job (user closed the page).
 * SIGKILL the whole tree: whisper/ffmpeg ignore softer signals mid-compute
 * for a long time, and nobody is waiting for a graceful result anyway.
 */
function cancelCurrent() {
  if (!currentChild) return false;
  cancelRequested = true;
  log.warn('processor', 'Cancelling current job — killing process tree');
  killTree(currentChild, 'SIGKILL');
  return true;
}

/** Stop the current job during graceful shutdown. */
function killCurrent() {
  if (currentChild) {
    log.warn('processor', 'Stopping current job (shutdown)');
    killTree(currentChild, 'SIGTERM');
  }
}

module.exports = { runScript, cancelCurrent, killCurrent };
