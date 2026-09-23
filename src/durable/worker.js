'use strict';
const fs = require('fs/promises');
const path = require('path');
const store = require('./store');
const cfg = require('../config');
const { runScript, cancelCurrent } = require('../processor');
const { deleteFile } = require('../cleanup');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// A dedicated PostgreSQL connection owns the global worker lock for its entire lifetime.
// Processing is never started unless that connection owns the lock.
async function startWorker() {
  let stopped = false, current = null, lockLost = false;
  const client = await store.pool.connect();
  client.on('error', () => { lockLost = true; stopped = true; cancelCurrent(); });
  const finished = (async () => {
    try {
      while (!stopped) {
        const { rows } = await client.query('SELECT pg_try_advisory_lock(836421) AS locked');
        if (rows[0].locked) break;
        await delay(500);
      }
      if (stopped) return;
      // Owning the global lock proves no other live worker owns these processing rows.
      // Interrupted jobs fail explicitly; queued jobs remain available. Users may retry renders.
      await client.query(`UPDATE subtitle_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'error' END,
        result=jsonb_build_object('status',CASE WHEN cancel_requested THEN 'cancelled' ELSE 'error' END,
        'message','Processing interrupted by a worker restart. Please try again.'),updated_at=now() WHERE status='processing'`);
      let lastCleanup = 0;
      while (!stopped) {
        if (Date.now() - lastCleanup > cfg.CLEANUP_INTERVAL_MS) { await cleanup(); lastCleanup = Date.now(); }
        const { rows } = await client.query(`UPDATE subtitle_jobs SET status='processing',updated_at=now()
          WHERE id=(SELECT id FROM subtitle_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1)
          AND status='queued' RETURNING *`);
        if (!rows.length) { await delay(250); continue; }
        current = rows[0];
        const job = current.payload;
        let cancel = false, polling = false;
        const watch = setInterval(async () => {
          if (polling) return;
          polling = true;
          try {
            const r = await client.query('SELECT cancel_requested FROM subtitle_jobs WHERE id=$1', [current.id]);
            if (r.rows[0]?.cancel_requested) { cancel = true; cancelCurrent(); }
          } catch { stopped = true; lockLost = true; cancelCurrent(); }
          finally { polling = false; }
        }, 200);
        try {
          const check = await client.query('SELECT cancel_requested FROM subtitle_jobs WHERE id=$1', [current.id]);
          if (check.rows[0].cancel_requested || stopped) { cancel = true; throw new Error('Cancelled'); }
          if (job.stage === 'transcribe') {
            if (job.needsCompress) {
              await phase(client, current.id, 'compress');
              await runScript(cfg.COMPRESS_SCRIPT, [job.videoPath, job.compressedPath, String(cfg.COMPRESS_TARGET_MB)]);
              job.videoPath = job.compressedPath;
            }
            if (cancel || stopped) throw new Error('Cancelled');
            await phase(client, current.id, 'transcribe');
            await runScript(cfg.TRANSCRIBE_SCRIPT, [job.videoPath, job.srtPath, job.language, job.model]);
          } else {
            await fs.writeFile(job.srtPath, job.srt, 'utf8');
            await runScript(cfg.BURN_SCRIPT, [job.videoPath, job.srtPath, job.outputPath]);
          }
          await store.transaction(async c => {
            const { rows } = await c.query('SELECT cancel_requested FROM subtitle_jobs WHERE id=$1 FOR UPDATE', [current.id]);
            if (rows[0].cancel_requested || cancel || stopped) throw new Error('Cancelled');
            let result;
            if (job.stage === 'transcribe') {
              const srt = await fs.readFile(job.srtPath, 'utf8');
              await c.query('UPDATE subtitle_sessions SET video_path=$2,srt_path=$3,srt=$4 WHERE id=$1', [job.sessionId, job.videoPath, job.srtPath, srt]);
              await c.query('INSERT INTO subtitle_versions(session_id,version,srt) VALUES($1,1,$2) ON CONFLICT DO NOTHING', [job.sessionId, srt]);
              result = { status: 'transcribed', sessionId: job.sessionId, videoFile: path.basename(job.videoPath), srtFile: path.basename(job.srtPath) };
            } else result = { status: 'done', outputFile: path.basename(job.outputPath), version: job.version };
            await c.query("UPDATE subtitle_jobs SET status='done',result=$2,updated_at=now() WHERE id=$1", [current.id, result]);
          });
        } catch (err) {
          if (job.outputPath) deleteFile(job.outputPath);
          if (!lockLost) await client.query(`UPDATE subtitle_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'error' END,
            result=jsonb_build_object('status',CASE WHEN cancel_requested THEN 'cancelled' ELSE 'error' END,'message',$2::text),updated_at=now() WHERE id=$1`, [current.id, stopped ? 'Processing interrupted by shutdown. Please try again.' : err.message]);
        } finally { clearInterval(watch); while (polling) await delay(10); current = null; }
      }
    } finally { if (!lockLost) await client.query('SELECT pg_advisory_unlock(836421)').catch(() => {}); client.release(lockLost); }
  })();
  return { stop: async () => { stopped = true; cancelCurrent(); await finished; }, finished };
}
async function phase(client, id, value) { await client.query("UPDATE subtitle_jobs SET payload=jsonb_set(payload,'{phase}',to_jsonb($2::text)),updated_at=now() WHERE id=$1", [id, value]); }
async function cleanup() {
  // Never remove files referenced by queued/running jobs, even when their session TTL passed.
  const expired = await store.pool.query(`DELETE FROM subtitle_sessions s WHERE expires_at<now()
    AND NOT EXISTS(SELECT 1 FROM subtitle_jobs j WHERE j.session_id=s.id AND j.status IN ('queued','processing'))`);
  await store.pool.query("DELETE FROM subtitle_quotas WHERE day < (now() AT TIME ZONE 'UTC')::date");
  const { rows } = await store.pool.query('SELECT video_path,srt_path FROM subtitle_sessions UNION ALL SELECT payload->>\'videoPath\',payload->>\'srtPath\' FROM subtitle_jobs');
  const protectedPaths = new Set(rows.flatMap(r => [r.video_path, r.srt_path]));
  const jobs = await store.pool.query('SELECT payload FROM subtitle_jobs');
  jobs.rows.forEach(r => { protectedPaths.add(r.payload.outputPath); protectedPaths.add(r.payload.compressedPath); });
  for (const dir of [cfg.UPLOAD_DIR, cfg.OUTPUT_DIR]) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = path.join(dir, entry.name);
      if (entry.isFile() && !protectedPaths.has(name) && Date.now() - (await fs.stat(name)).mtimeMs > cfg.FILE_TTL_MS) deleteFile(name);
    }
  }
  return expired.rowCount;
}
module.exports = { startWorker };
