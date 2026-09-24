'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { once } = require('node:events');
test('disk upload accepts the complete form and removes rejected multipart files', async t => {
  const dir = fs.mkdtempSync(`${os.tmpdir()}/streaming-test-`);
  process.env.UPLOAD_DIR = dir; process.env.MAX_FILE_SIZE_MB = '1';
  const app = require('express')();
  const { upload } = require('../src/durable/upload');
  app.post('/upload', upload.single('video'), (req, res) => res.json({ size: req.file.size, language: req.body.language, model: req.body.model }));
  app.use((err, _req, res, _next) => res.status(413).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const send = (bytes, extra = false) => {
    const form = new FormData(); form.set('video', new Blob([Buffer.alloc(bytes)]), 'test.mp4'); form.set('language', 'English'); form.set('model', 'medium');
    if (extra) form.set('extra', 'unexpected');
    return fetch(`http://127.0.0.1:${server.address().port}/upload`, { method: 'POST', body: form });
  };
  const accepted = await send(7); assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { size: 7, language: 'English', model: 'medium' });
  const before = fs.readdirSync(dir).sort();
  assert.equal((await send(7, true)).status, 413);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
  assert.equal((await send(1024 * 1024 + 1)).status, 413);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});
