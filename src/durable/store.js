'use strict';
const { Pool } = require('pg');
const crypto = require('crypto');
const cfg = require('../config');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
pool.on('error', err => console.error('Database connection error:', err.message));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
async function transaction(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const value = await fn(c); await c.query('COMMIT'); return value; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function migrate() {
  await transaction(async c => {
    await c.query('SELECT pg_advisory_xact_lock(836420)');
    await c.query(`CREATE TABLE IF NOT EXISTS subtitle_sessions (
      id uuid PRIMARY KEY, video_path text NOT NULL, srt_path text, srt text,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS subtitle_jobs (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES subtitle_sessions(id) ON DELETE CASCADE,
      stage text NOT NULL CHECK(stage IN ('transcribe','burn')),
      status text NOT NULL CHECK(status IN ('queued','processing','done','error','cancelled')),
      payload jsonb NOT NULL, result jsonb, cancel_requested boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS subtitle_one_active_render ON subtitle_jobs(session_id)
      WHERE stage='burn' AND status IN ('queued','processing');
    CREATE INDEX IF NOT EXISTS subtitle_queue ON subtitle_jobs(created_at,id) WHERE status='queued';
    CREATE TABLE IF NOT EXISTS subtitle_quotas (
      subject text NOT NULL, day date NOT NULL, used integer NOT NULL, PRIMARY KEY(subject,day));`);
  });
}
function subject(ip) { return crypto.createHash('sha256').update(ip || '').digest('hex'); }
async function remaining(ip) {
  const { rows } = await pool.query("SELECT used FROM subtitle_quotas WHERE subject=$1 AND day=(now() AT TIME ZONE 'UTC')::date", [subject(ip)]);
  return Math.max(0, cfg.DAILY_LIMIT - (rows[0]?.used || 0));
}
async function accept(job, ip, licensed) {
  return transaction(async c => {
    if (!licensed) {
      if (cfg.DAILY_LIMIT <= 0) throw fail(429, 'Daily limit reached.');
      const { rowCount } = await c.query(`INSERT INTO subtitle_quotas(subject,day,used) VALUES($1,(now() AT TIME ZONE 'UTC')::date,1)
        ON CONFLICT(subject,day) DO UPDATE SET used=subtitle_quotas.used+1
        WHERE subtitle_quotas.used<$2 RETURNING used`, [subject(ip), cfg.DAILY_LIMIT]);
      if (!rowCount) throw fail(429, 'Daily limit reached.');
    }
    await c.query('INSERT INTO subtitle_sessions(id,video_path,expires_at) VALUES($1,$2,$3)', [job.jobId, job.videoPath, new Date(Date.now() + cfg.FILE_TTL_MS)]);
    await c.query("INSERT INTO subtitle_jobs(id,session_id,stage,status,payload) VALUES($1,$1,'transcribe','queued',$2)", [job.jobId, job]);
    return { jobId: job.jobId, durable: true };
  });
}
async function session(id, client = pool) {
  if (!uuid.test(id)) throw fail(404, 'Session not found or expired.');
  const { rows } = await client.query('SELECT * FROM subtitle_sessions WHERE id=$1 AND expires_at>now()', [id]);
  if (!rows[0]) throw fail(404, 'Session not found or expired. Please upload the video again.');
  return rows[0];
}
async function apply(id, srt) {
  if (typeof srt !== 'string' || !srt.trim()) throw fail(400, 'Non-empty srt is required.');
  if (Buffer.byteLength(srt) > cfg.MAX_SRT_SIZE_KB * 1024) throw fail(413, 'Subtitles are too large.');
  return transaction(async c => {
    const s = await session(id, c);
    await c.query('SELECT id FROM subtitle_sessions WHERE id=$1 FOR UPDATE', [id]);
    if (!s.srt_path) throw fail(409, 'Transcription is not ready.');
    const { rowCount } = await c.query("SELECT id FROM subtitle_jobs WHERE session_id=$1 AND stage='burn' AND status IN ('queued','processing')", [id]);
    if (rowCount) throw fail(409, 'This session already has a queued or running render.');
    const jobId = crypto.randomUUID();
    const path = require('path');
    const payload = { jobId, sessionId: id, stage: 'burn', videoPath: s.video_path, srtPath: path.join(cfg.OUTPUT_DIR, `${jobId}.srt`), srt, outputPath: path.join(cfg.OUTPUT_DIR, `${jobId}.mp4`) };
    await c.query('UPDATE subtitle_sessions SET srt=$2 WHERE id=$1', [id, srt]);
    await c.query("INSERT INTO subtitle_jobs(id,session_id,stage,status,payload) VALUES($1,$2,'burn','queued',$3)", [jobId, id, payload]);
    return { jobId, durable: true };
  });
}
async function getJob(id) {
  if (!uuid.test(id)) throw fail(404, 'Job not found.');
  const { rows } = await pool.query('SELECT j.* FROM subtitle_jobs j JOIN subtitle_sessions s ON s.id=j.session_id WHERE j.id=$1 AND s.expires_at>now()', [id]);
  const job = rows[0];
  if (!job) throw fail(404, 'Job not found or expired.');
  if (job.result) return { jobId: id, ...job.result, durable: true };
  const result = { jobId: id, sessionId: job.session_id, status: job.status, stage: job.payload.phase || job.stage, durable: true };
  if (job.status === 'queued') {
    const pos = await pool.query("SELECT count(*)::int AS n FROM subtitle_jobs WHERE status='queued' AND (created_at,id)<=($1,$2)", [job.created_at, job.id]);
    result.position = pos.rows[0].n;
  }
  return result;
}
async function cancel(id) {
  await getJob(id);
  await pool.query(`UPDATE subtitle_jobs SET cancel_requested=true, updated_at=now(),
    status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
    result=CASE WHEN status='queued' THEN '{"status":"cancelled","message":"Job cancelled."}'::jsonb ELSE result END
    WHERE id=$1 AND status IN ('queued','processing')`, [id]);
  return getJob(id);
}
async function sessionView(id) {
  const s = await session(id);
  if (!s.srt_path) throw fail(409, 'Transcription is not ready.');
  const { rows } = await pool.query("SELECT id FROM subtitle_jobs WHERE session_id=$1 AND stage='burn' ORDER BY created_at DESC,id DESC LIMIT 1", [id]);
  return { sessionId: id, videoFile: require('path').basename(s.video_path), srtFile: require('path').basename(s.srt_path), durable: true, renderJobId: rows[0]?.id || null };
}
module.exports = { pool, migrate, transaction, remaining, accept, session, sessionView, apply, getJob, cancel, fail };
