// Executes the real upload -> transcribe -> edit -> render -> download flow.
// Supply a small authorized fixture with speech; no stub processors are used by this script.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.SMOKE_BASE_URL;
const video = process.env.SMOKE_VIDEO;
if (!base || !video || !fs.existsSync(video)) throw new Error('Set SMOKE_BASE_URL and SMOKE_VIDEO (a small video fixture with speech).');
if (!/^https?:\/\//.test(base)) throw new Error('Expected an HTTP(S) base URL');
let cookie = '';
const ids = [];
async function request(url, init = {}) {
  const response = await fetch(new URL(url, base), { ...init, headers: { Cookie: cookie, ...init.headers }, signal: AbortSignal.timeout(60000), redirect: 'error' });
  const set = response.headers.getSetCookie();
  if (set.length) cookie = set.map(value => value.split(';')[0]).join('; ');
  return response;
}
async function wait(id, expected) {
  const deadline = Date.now() + Number(process.env.SMOKE_TIMEOUT_MS || 1800000);
  while (Date.now() < deadline) {
    const response = await request(`/jobs/${id}`); assert.equal(response.status, 200);
    const job = await response.json();
    if (job.status === expected) return job;
    if (['error', 'cancelled'].includes(job.status)) throw new Error(`Job ${job.status}: ${job.message}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Timed out waiting for media processing');
}
try {
  assert.equal((await request('/health')).status, 200);
  const options = await (await request('/options')).json();
  assert.equal(options.durable, true); assert.match(cookie, /subtitle_owner=/);
  const form = new FormData();
  form.set('language', 'English'); form.set('model', 'medium');
  // Node openAsBlob streams the local fixture rather than buffering it into memory.
  form.set('video', await fs.openAsBlob(video), path.basename(video));
  const upload = await request('/upload', { method: 'POST', body: form }); assert.equal(upload.status, 200);
  const id = (await upload.json()).jobId; ids.push(id);
  await wait(id, 'transcribed');
  const session = await (await request(`/sessions/${id}`)).json();
  const range = await request(`/videos/${session.videoFile}`, { headers: { Range: 'bytes=0-15' } });
  assert.equal(range.status, 206); await range.arrayBuffer();
  const srt = '1\n00:00:00,000 --> 00:00:01,000\nStaging smoke test\n';
  const apply = await request('/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: id, srt }) });
  assert.equal(apply.status, 200); const render = (await apply.json()).jobId; ids.push(render);
  const result = await wait(render, 'done');
  const download = await request(`/outputs/${result.outputFile}`); assert.equal(download.status, 200);
  const reader = download.body.getReader(); let bytes = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; }
  assert.ok(bytes > 0);
  assert.equal(await (await request(`/sessions/${id}/versions/2`)).text(), srt);
  assert.equal((await fetch(new URL(`/outputs/${result.outputFile}`, base), { redirect: 'error' })).status, 404);
  console.log('Staging smoke passed: durable upload, transcription, session, Range, edit, render, versioned SRT, video and denied anonymous access.');
} catch (error) {
  // Cancel only this smoke run's jobs; never touch other users' work.
  for (const id of ids) await request(`/jobs/${id}/cancel`, { method: 'POST' }).catch(() => {});
  throw error;
}
