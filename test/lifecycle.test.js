'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { WebSocket } = require('ws');

const SRT = '1\n00:00:00,000 --> 00:00:01,000\nHello\n';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(20);
  }
  throw new Error('Timed out waiting for condition');
}

async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-test-'));
  const write = (name, content) => fs.writeFileSync(path.join(dir, name), content, { mode: 0o755 });
  write('ffprobe', '#!/bin/sh\nprintf "1\\n"\n');
  write('transcribe.sh', '#!/bin/bash\nset -eu\nprintf "1\\n00:00:00,000 --> 00:00:01,000\\nHello\\n" > "$2"\n');
  write('burn.sh', `#!/bin/bash
set -eu
touch "$TEST_DIR/started"
while [ ! -f "$TEST_DIR/release" ]; do sleep 0.02; done
if [ -f "$TEST_DIR/fail" ]; then echo failed >&2; exit 1; fi
cat "$2" > "$3"
`);
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1',
      PATH: `${dir}:${process.env.PATH}`, TEST_DIR: dir,
      UPLOAD_DIR: path.join(dir, 'uploads'), TRANSCRIBE_SCRIPT: path.join(dir, 'transcribe.sh'),
      BURN_SCRIPT: path.join(dir, 'burn.sh'), DAILY_LIMIT: '100', FILE_TTL_HOURS: '24' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  const sockets = [];
  t.after(async () => {
    sockets.forEach(ws => ws.terminate());
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const request = (url, options) => fetch(base + url, options);
  try { await until(async () => { try { return (await request('/health')).ok; } catch { return false; } }); }
  catch (error) { throw new Error(`${error.message}\n${logs}`); }
  function connect(jobId) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?jobId=${jobId}`);
    const messages = [];
    ws.on('message', data => messages.push(JSON.parse(data)));
    ws.on('error', () => {});
    sockets.push(ws);
    return { ws, messages, wait: status => until(() => messages.find(m => m.status === status)) };
  }
  async function upload() {
    const data = new FormData();
    data.append('video', new Blob(['video fixture']), 'test.mp4');
    data.append('language', 'English');
    data.append('model', 'medium');
    const response = await request('/upload', { method: 'POST', body: data });
    assert.equal(response.status, 200);
    return (await response.json()).jobId;
  }
  const apply = (jobId, srt = SRT) => request('/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, srt })
  });
  async function session() {
    const id = await upload();
    const channel = connect(id);
    const result = await channel.wait('transcribed');
    channel.ws.close();
    return { id, ...result };
  }
  const idle = () => until(async () => !(await (await request('/health')).json()).workerBusy);
  return { dir, write, request, connect, upload, apply, session, idle };
}

test('upload → edit → render → download SRT/video → edit and render again', async t => {
  const h = await start(t);
  h.write('release', '');
  const s = await h.session();
  const handoff = await h.request(`/sessions/${s.id}`);
  assert.equal(handoff.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await handoff.json(), { sessionId: s.id, videoFile: s.videoFile, srtFile: s.srtFile });
  assert.equal((await h.request('/sessions/expired')).status, 404);
  const first = await h.apply(s.id);
  const firstDone = await h.connect((await first.json()).jobId).wait('done');
  assert.equal(await (await h.request(`/outputs/${firstDone.outputFile}`)).text(), SRT);
  assert.equal(await (await h.request(`/outputs/${s.srtFile}`)).text(), SRT);
  assert.equal((await h.request(`/videos/${s.videoFile}`)).status, 200);
  const range = await h.request(`/videos/${s.videoFile}`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), 'vide');
  await h.idle();
  const edited = SRT.replace('Hello', 'Second edit\nAnother line');
  const second = await h.apply(s.id, edited);
  assert.equal(second.status, 200);
  const secondDone = await h.connect((await second.json()).jobId).wait('done');
  assert.notEqual(firstDone.outputFile, secondDone.outputFile);
  assert.equal(await (await h.request(`/outputs/${secondDone.outputFile}`)).text(), edited);
  assert.equal(await (await h.request(`/outputs/${firstDone.outputFile}`)).text(), SRT);
  assert.equal(await (await h.request(`/srt/${s.id}`)).text(), edited);
});

test('reject duplicate processing and queued renders without changing their SRT', async t => {
  const h = await start(t);
  const a = await h.session();
  const b = await h.session();
  const first = await h.apply(a.id);
  const running = h.connect((await first.json()).jobId);
  await running.wait('processing');
  const second = await h.apply(b.id);
  const queued = h.connect((await second.json()).jobId);
  await queued.wait('queued');
  for (const id of [a.id, b.id]) {
    assert.equal((await h.apply(id, SRT.replace('Hello', 'DO NOT WRITE'))).status, 409);
    assert.equal(await (await h.request(`/srt/${id}`)).text(), SRT);
  }
  h.write('release', '');
  await running.wait('done');
  await queued.wait('done');
});

test('failed render keeps session and earlier result available for retry', async t => {
  const h = await start(t);
  h.write('release', '');
  const s = await h.session();
  const first = await h.apply(s.id);
  const done = await h.connect((await first.json()).jobId).wait('done');
  await h.idle();
  h.write('fail', '');
  const failed = await h.apply(s.id);
  const failedId = (await failed.json()).jobId;
  await h.idle(); // Also exercise a terminal error before WS attachment.
  await h.connect(failedId).wait('error');
  assert.equal(await (await h.request(`/outputs/${done.outputFile}`)).text(), SRT);
  assert.equal((await h.request(`/srt/${s.id}`)).status, 200);
  fs.unlinkSync(path.join(h.dir, 'fail'));
  const retry = await h.apply(s.id);
  assert.equal(retry.status, 200);
  await h.connect((await retry.json()).jobId).wait('done');
});

test('cancelled running and queued renders release session for another apply', async t => {
  const h = await start(t);
  const a = await h.session();
  const b = await h.session();
  const first = h.connect((await (await h.apply(a.id)).json()).jobId);
  await first.wait('processing');
  const second = h.connect((await (await h.apply(b.id)).json()).jobId);
  await second.wait('queued');
  second.ws.close();
  await until(async () => (await (await h.request('/health')).json()).length === 1);
  first.ws.close();
  await h.idle();
  h.write('release', '');
  for (const id of [a.id, b.id]) {
    assert.equal((await h.request(`/srt/${id}`)).status, 200);
    const retry = await h.apply(id);
    assert.equal(retry.status, 200);
    await h.connect((await retry.json()).jobId).wait('done');
    await h.idle();
  }
});

test('late WebSocket attachment receives already completed transcription', async t => {
  const h = await start(t);
  const id = await h.upload();
  await h.idle();
  const result = await h.connect(id).wait('transcribed');
  assert.equal(result.sessionId, id);
  assert.equal((await h.request(`/srt/${id}`)).status, 200);
});

test('apply rejects missing body, empty subtitles and unknown sessions', async t => {
  const h = await start(t);
  assert.equal((await h.request('/apply', { method: 'POST' })).status, 400);
  assert.equal((await h.apply('unknown', '')).status, 400);
  assert.equal((await h.apply('unknown')).status, 404);
});
