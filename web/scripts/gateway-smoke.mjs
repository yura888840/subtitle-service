// Run after next build, with backend dependencies and nginx installed.
// Real HTTP/WS and Nginx routing; stub media commands avoid Whisper downloads.
import assert from 'node:assert/strict';
import { testUploadBrowser } from './upload-browser-smoke.mjs';
import { testDurableBrowser } from './durable-browser-smoke.mjs';
import { testEditorBrowser } from './editor-browser-smoke.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(web);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-gateway-'));
const children = [];
const sockets = [];
let logs = '';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for readiness/result\n${logs}`);
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function run(command, args, cwd, env = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  child.on('error', error => { logs += error.message; });
  children.push(child);
  return child;
}
const write = (name, content) => fs.writeFileSync(path.join(dir, name), content, { mode: 0o755 });
try {
  const mediaPort = await freePort();
  const webPort = await freePort();
  const gatewayPort = await freePort();
  write('ffprobe', '#!/bin/sh\necho 1\n');
  write('transcribe.sh', '#!/bin/bash\nset -eu\nsleep 0.3\nprintf "1\\n00:00:00,000 --> 00:00:01,000\\nHello\\n" > "$2"\n');
  write('burn.sh', '#!/bin/bash\nset -eu\nsleep 0.3\ncat "$2" > "$3"\n');
  run(process.execPath, ['src/server.js'], root, {
    PORT: String(mediaPort), HOST: '127.0.0.1', PATH: `${dir}:${process.env.PATH}`,
    UPLOAD_DIR: path.join(dir, 'uploads'), TRANSCRIBE_SCRIPT: path.join(dir, 'transcribe.sh'),
    BURN_SCRIPT: path.join(dir, 'burn.sh'), LICENSE_KEY: 'test-only-license',
    LEGAL_NAME: 'Gateway Test Operator', LEGAL_EMAIL: 'operator@example.test', MAX_VIDEO_DURATION_SEC: '360', DAILY_LIMIT: '5',
  });
  const standalone = path.join(web, '.next/standalone/web');
  fs.cpSync(path.join(web, '.next/static'), path.join(standalone, '.next/static'), { recursive: true });
  fs.cpSync(path.join(web, 'public'), path.join(standalone, 'public'), { recursive: true });
  run(process.execPath, ['server.js'], standalone, { PORT: String(webPort), HOSTNAME: '127.0.0.1', MEDIA_API_URL: `http://127.0.0.1:${mediaPort}`, SITE_URL: 'https://subtitles.example.test' });
  for (const [port, url] of [[mediaPort, '/health'], [webPort, '/api/health']]) {
    await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}${url}`)).ok; } catch { return false; } });
  }
  const gateway = fs.readFileSync(path.join(root, 'nginx/next-gateway.conf'), 'utf8')
    .replace('subtitle-service:3000', `127.0.0.1:${mediaPort}`)
    .replace('web:3001', `127.0.0.1:${webPort}`)
    .replace('listen 80;', `listen ${gatewayPort};`);
  write('nginx.conf', `worker_processes 1;\npid ${dir}/nginx.pid;\nerror_log stderr;\nevents {}\nhttp {\naccess_log off;\nclient_body_temp_path ${dir}/body;\nproxy_temp_path ${dir}/proxy;\n${gateway}\n}\n`);
  run(process.env.NGINX_BIN || 'nginx', ['-p', dir, '-c', path.join(dir, 'nginx.conf'), '-g', 'daemon off;'], root);
  const base = `http://127.0.0.1:${gatewayPort}`;
  const request = (url, options) => fetch(base + url, options);
  await until(async () => { try { return (await request('/api/health')).ok; } catch { return false; } });
  assert.deepEqual(await (await request('/api/health')).json(), { status: 'ok', service: 'web' });
  const page = await (await request('/')).text();
  assert.match(page, /Speak your language/);
  const asset = page.match(/(?:src|href)="([^" ]*\/_next\/[^" ]+)"/);
  assert.ok(asset, 'Next.js asset is present');
  assert.equal((await request(asset[1].replaceAll('&amp;', '&'))).status, 200);
  for (const url of ['/studio', '/uk', '/seo', '/uk/seo', '/impressum', '/datenschutz']) {
    assert.equal((await request(url)).status, 200, url);
  }
  for (const [oldPath, newPath] of [['/index.html', '/'], ['/impressum.html', '/impressum'], ['/datenschutz.html', '/datenschutz'], ['/ceo.html', '/seo'], ['/seo.html', '/seo']]) {
    const redirect = await request(oldPath, { redirect: 'manual' });
    assert.equal(redirect.status, 308, oldPath);
    assert.equal(new URL(redirect.headers.get('location'), base).pathname, newPath);
  }
  const seo = await (await request('/seo')).text();
  assert.match(seo, /name="robots" content="index, follow"/);
  assert.match(seo, /https:\/\/subtitles.example.test\/seo/);
  assert.doesNotMatch(seo, /Executive Brief|COGS/);
  const uk = await (await request('/uk/seo')).text();
  assert.match(uk, /<html lang="uk"/);
  const legalPage = await (await request('/impressum')).text();
  assert.match(legalPage, /<html lang="de"/);
  assert.match(legalPage, /Gateway Test Operator/);
  assert.match(legalPage, /operator@example.test/);
  const sitemap = await (await request('/sitemap.xml')).text();
  assert.match(sitemap, /https:\/\/subtitles.example.test\/uk\/seo/);
  assert.doesNotMatch(sitemap, /ceo|localhost|studio/);
  assert.equal((await request('/robots.txt')).status, 200);
  const options = await (await request('/options')).json();
  assert.ok(options.models.includes('medium'));
  assert.equal((await request('/legal')).status, 200);
  const license = await request('/license', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'test-only-license' }),
  });
  assert.equal(license.status, 200);
  const cookie = license.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await request('/license/status', { headers: { Cookie: cookie } })).json()).active, true);
  async function result(jobId, status) {
    const ws = new WebSocket(`ws://127.0.0.1:${gatewayPort}/ws?jobId=${jobId}`);
    sockets.push(ws);
    const messages = [];
    ws.addEventListener('message', event => messages.push(JSON.parse(event.data)));
    const message = await until(() => messages.find(item => item.status === status));
    ws.close();
    return message;
  }
  const form = new FormData();
  // Exceeds the stock Nginx 1 MB limit: protects the upload gateway configuration.
  form.append('video', new Blob([new Uint8Array(2 * 1024 * 1024)]), 'fixture.mp4');
  form.append('language', 'English');
  form.append('model', 'medium');
  const upload = await request('/upload', { method: 'POST', body: form });
  assert.equal(upload.status, 200);
  const { jobId } = await upload.json();
  const transcribed = await result(jobId, 'transcribed');
  const srt = await (await request(`/srt/${jobId}`)).text();
  assert.match(srt, /Hello/);
  const range = await request(`/videos/${transcribed.videoFile}`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 4);
  assert.equal((await request(`/outputs/${transcribed.srtFile}`)).status, 200);
  const apply = await request('/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, srt }),
  });
  assert.equal(apply.status, 200);
  const done = await result((await apply.json()).jobId, 'done');
  assert.equal(await (await request(`/outputs/${done.outputFile}`)).text(), srt);
  await testUploadBrowser(base);
  await testEditorBrowser(base);
  await testDurableBrowser(base);
  console.log('Gateway smoke passed: Next page/assets, legacy pages, API, cookie, 2 MB upload, WS, Range and render download.');
} finally {
  sockets.forEach(ws => ws.close());
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.pid) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await stopped;
      clearTimeout(timer);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
