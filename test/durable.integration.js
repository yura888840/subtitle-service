'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Pool } = require('pg');
const delay = ms => new Promise(r => setTimeout(r, ms));
const root = path.resolve(__dirname, '..');
async function until(fn) { for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await delay(100); } throw new Error('Timed out'); }
test('durable quota, reconnect, restart, cancellation and worker exclusion', { timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-'));
  fs.mkdirSync(path.join(dir, 'outputs'));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), value, { mode: 0o755 });
  write('ffprobe', '#!/bin/sh\necho 1\n');
  write('transcribe.sh', '#!/bin/bash\nwhile [ ! -f "$UPLOAD_DIR/release" ]; do sleep .05; done\nprintf "1\\n00:00:00,000 --> 00:00:01,000\\nHello\\n" > "$2"\n');
  write('burn.sh', '#!/bin/bash\nwhile [ ! -f "$UPLOAD_DIR/release-burn" ]; do sleep .05; done\ncp "$2" "$3"\n');
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  let server, other, worker, web; let logs = '';
  const env = { ...process.env, PORT: '39117', HOST: '127.0.0.1', UPLOAD_DIR: dir, PATH: `${dir}:${process.env.PATH}`, TRANSCRIBE_SCRIPT: path.join(dir, 'transcribe.sh'), BURN_SCRIPT: path.join(dir, 'burn.sh'), DAILY_LIMIT: '1', LICENSE_KEY: 'test-key', SESSION_SECRET: 'test-only-ownership-secret-at-least-32-characters', COOKIE_SECURE: 'false' };
  const start = (role = 'media') => { const child = spawn(process.execPath, [role === 'worker' ? 'src/durable/worker-main.js' : role === 'web' ? 'web/.next/standalone/web/server.js' : 'src/server.js'], { cwd: root, env: { ...env, PORT: role === 'web' ? '39119' : '39117', HOSTNAME: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; }); return child; };
  const stop = async child => { if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } };
  let cookie = '';
  const request = (url, init) => fetch(`http://127.0.0.1:${url === '/upload' || url.startsWith('/outputs/') ? '39117' : '39119'}${url}`, { ...init, headers: { 'X-Real-IP': '127.0.0.1', Cookie: cookie, ...init?.headers } });
  const job = async id => (await request(`/jobs/${id}`)).json();
  const wait = (id, status) => until(async () => { const value = await job(id); return value.status === status && value; });
  const upload = async (licensed = false) => { const form = new FormData(); form.set('video', new Blob(['fixture']), 'test.mp4'); form.set('model', 'medium'); form.set('language', 'English'); return request('/upload', { method: 'POST', body: form, headers: licensed ? { Cookie: `${cookie}; license=test-key` } : {} }); };
  t.after(async () => { await stop(other); await stop(worker); await stop(web); await stop(server); await db.end(); fs.rmSync(dir, { recursive: true, force: true }); });
  try {
    server = start(); web = start('web'); worker = start('worker');
    await until(() => request('/health').then(r => r.ok).catch(() => false));
    cookie = (await request('/options')).headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^subtitle_owner=/);
    await db.query('TRUNCATE subtitle_jobs,subtitle_sessions,subtitle_quotas CASCADE');
    const results = await Promise.all([upload(), upload(), upload(), upload()]);
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.equal(results.filter(r => r.status === 429).length, 3);
    const id = (await results.find(r => r.status === 200).json()).jobId;
    await wait(id, 'processing');
    // No observer has ever attached. Job continues and state is queryable repeatedly.
    assert.equal((await job(id)).status, 'processing');
    other = start('worker');
    const queued = (await (await upload(true)).json()).jobId;
    await delay(600);
    assert.equal((await job(queued)).status, 'queued');
    assert.equal((await job(queued)).position, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM subtitle_jobs WHERE status='processing'")).rows[0].n, 1);
    await stop(other); other = null;
    // Abrupt server death: supervisor kills script, next owner fails interrupted row.
    worker.kill('SIGKILL'); await once(worker, 'exit');
    worker = start('worker');
    await until(() => request('/health').then(r => r.ok).catch(() => false));
    await wait(id, 'error');
    assert.equal((await (await request('/license/status')).json()).remaining, 0);
    await request(`/jobs/${queued}/cancel`, { method: 'POST' });
    await wait(queued, 'cancelled');
    write('release', '');
    const session = (await (await upload(true)).json()).jobId;
    await wait(session, 'transcribed');
    await stop(web); web = start('web');
    await until(() => request('/health').then(r => r.ok).catch(() => false));
    assert.equal((await request(`/sessions/${session}`)).status, 200);
    assert.match(await (await request(`/srt/${session}`)).text(), /Hello/);
    const apply = srt => request('/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: session, srt }) });
    const renders = await Promise.all([apply('first'), apply('second')]);
    assert.deepEqual(renders.map(r => r.status).sort(), [200,409]);
    const render = (await renders.find(r => r.status === 200).json()).jobId;
    await wait(render, 'processing');
    // Restart both HTTP processes during the heavy task; the separate worker keeps its slot.
    await stop(web); await stop(server); web = start('web'); server = start();
    await until(() => request('/health').then(r => r.ok).catch(() => false));
    assert.equal((await job(render)).status, 'processing');
    await request(`/jobs/${render}/cancel`, { method: 'POST' });
    await wait(render, 'cancelled');
    write('release-burn', '');
    const retry = (await (await apply('final')).json()).jobId;
    const done = await wait(retry, 'done');
    assert.equal(await (await request(`/outputs/${done.outputFile}`)).text(), 'final');
    assert.equal((await (await request(`/sessions/${session}`)).json()).renderJobId, retry);
    assert.equal((await request('/jobs/not-a-uuid')).status, 404);
    const history = await (await request(`/sessions/${session}/versions`)).json();
    assert.equal(history.length, 3);
    assert.equal(await (await request(`/sessions/${session}/versions/1`)).text(), '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
    assert.equal(await (await request(`/sessions/${session}/versions/3`)).text(), 'final');
    assert.equal(history[0].renders[0].outputFile, done.outputFile);
    // Neither guessed IDs nor known file names authorize a second browser.
    const view = await (await request(`/sessions/${session}`)).json();
    const stranger = (await request('/options', { headers: { Cookie: '' } })).headers.get('set-cookie').split(';')[0];
    for (const url of [`/sessions/${session}`, `/srt/${session}`, `/jobs/${retry}`, `/sessions/${session}/versions`, `/sessions/${session}/versions/1`, `/outputs/${done.outputFile}`]) {
      assert.equal((await request(url, { headers: { Cookie: stranger } })).status, 404, url);
      assert.equal((await request(url, { headers: { Cookie: '' } })).status, 404, url);
    }
    assert.equal((await fetch(`http://127.0.0.1:39117/videos/${view.videoFile}`, { headers: { Cookie: stranger } })).status, 404);
    const range = await fetch(`http://127.0.0.1:39117/videos/${view.videoFile}`, { headers: { Cookie: cookie, Range: 'bytes=0-2' } });
    assert.equal(range.status, 206); assert.equal(await range.text(), 'fix');
    assert.match(range.headers.get('cache-control'), /no-store/);
    assert.equal((await request(`/jobs/${retry}/cancel`, { method: 'POST', headers: { Cookie: stranger } })).status, 404);
    assert.equal((await request('/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: stranger }, body: JSON.stringify({ jobId: session, srt: 'stolen' }) })).status, 404);
    assert.equal((await request('/apply', { method: 'POST', headers: { Origin: 'https://attacker.example' } })).status, 403);
    const earlierOutput = done.outputFile;
    const next = (await (await apply('fourth')).json()).jobId;
    const nextDone = await wait(next, 'done');
    assert.notEqual(nextDone.outputFile, earlierOutput);
    assert.equal(await (await request(`/outputs/${earlierOutput}`)).text(), 'final');
    assert.equal(await (await request(`/outputs/${nextDone.outputFile}`)).text(), 'fourth');
    assert.equal((await request('/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
    assert.equal((await request('/apply', { method: 'POST', body: 'x'.repeat(3 * 1024 * 1024) })).status, 413);
    // Execute the reusable staging acceptance command against this real split-process stack.
    const proxy = require('node:http').createServer((req, res) => {
      const port = req.url === '/upload' || req.url.startsWith('/videos/') || req.url.startsWith('/outputs/') ? 39117 : 39119;
      const upstream = require('node:http').request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, 'x-real-ip': '198.51.100.23' } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('error', () => { res.statusCode = 502; res.end(); }); req.pipe(upstream);
    });
    proxy.listen(39120, '127.0.0.1'); await once(proxy, 'listening');
    const fixture = path.join(dir, 'smoke.mp4'); fs.writeFileSync(fixture, 'fixture');
    try {
      // Reset only this isolated test database's quota before the acceptance run.
      await db.query('TRUNCATE subtitle_quotas');
      const smoke = spawn(process.execPath, ['scripts/staging-smoke.mjs'], { cwd: root, env: { ...env, SMOKE_BASE_URL: 'http://127.0.0.1:39120', SMOKE_VIDEO: fixture }, stdio: ['ignore', 'pipe', 'pipe'] });
      smoke.stdout.on('data', b => { logs += b; }); smoke.stderr.on('data', b => { logs += b; });
      assert.equal((await once(smoke, 'exit'))[0], 0);
    } finally { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    // An interrupted multipart stream must not leave its temporary file behind.
    const before = fs.readdirSync(dir).filter(name => name.endsWith('.mp4')).sort();
    const http = require('node:http');
    const partial = http.request('http://127.0.0.1:39117/upload', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=partial', Cookie: cookie } });
    partial.on('error', () => {});
    partial.write('--partial\r\nContent-Disposition: form-data; name="video"; filename="partial.mp4"\r\nContent-Type: video/mp4\r\n\r\n');
    partial.write(Buffer.alloc(65536));
    await until(() => fs.readdirSync(dir).filter(name => name.endsWith('.mp4')).length > before.length);
    partial.destroy();
    await until(() => JSON.stringify(fs.readdirSync(dir).filter(name => name.endsWith('.mp4')).sort()) === JSON.stringify(before));
    // Expiry cannot delete an active input. Once cancelled, metadata/files expire together.
    fs.unlinkSync(path.join(dir, 'release'));
    const protectedId = (await (await upload(true)).json()).jobId;
    await wait(protectedId, 'processing');
    const protectedPath = (await db.query('SELECT video_path FROM subtitle_sessions WHERE id=$1', [protectedId])).rows[0].video_path;
    await db.query("UPDATE subtitle_sessions SET expires_at=now()-interval '1 hour' WHERE id=$1", [protectedId]);
    const old = new Date(Date.now() - 48 * 3600000); fs.utimesSync(protectedPath, old, old);
    const clean = async () => {
      const child = spawn(process.execPath, ['-e', "const s=require('./src/durable/store');require('./src/durable/worker').cleanup().then(()=>s.pool.end()).catch(e=>{console.error(e);process.exit(1)})"], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stderr.on('data', b => { logs += b; });
      assert.equal((await once(child, 'exit'))[0], 0);
    };
    await clean(); assert.ok(fs.existsSync(protectedPath));
    assert.equal((await db.query('SELECT id FROM subtitle_sessions WHERE id=$1', [protectedId])).rowCount, 1);
    await db.query('UPDATE subtitle_jobs SET cancel_requested=true WHERE id=$1', [protectedId]);
    await until(async () => (await db.query('SELECT status FROM subtitle_jobs WHERE id=$1', [protectedId])).rows[0]?.status === 'cancelled');
    await clean(); assert.equal(fs.existsSync(protectedPath), false);
    assert.equal((await db.query('SELECT id FROM subtitle_sessions WHERE id=$1', [protectedId])).rowCount, 0);
  } catch (err) { console.error(logs); throw err; }
});
