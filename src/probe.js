'use strict';

const { spawn } = require('child_process');

/**
 * Get media duration in seconds via ffprobe.
 * Also serves as an early sanity check: a file ffprobe can't read
 * is not a video we can process.
 */
function getDurationSec(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error('Could not read the video file. Is it a valid video?'));
      }
      const dur = parseFloat(out.trim());
      if (!isFinite(dur) || dur <= 0) {
        return reject(new Error('Could not determine video duration.'));
      }
      resolve(dur);
    });

    child.on('error', () => reject(new Error('ffprobe is not available on the server.')));
  });
}

module.exports = { getDurationSec };
