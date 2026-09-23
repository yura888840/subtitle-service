// Exercises the production standalone server without requiring media tools/Nginx.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(web, '.next/standalone/web');
fs.cpSync(path.join(web, '.next/static'), path.join(standalone, '.next/static'), { recursive: true });
fs.cpSync(path.join(web, 'public'), path.join(standalone, 'public'), { recursive: true });
let dailyLimit = 5;
const backend = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/options') return res.end(JSON.stringify({ maxFileSizeMb: 99, maxDurationSec: 360, dailyLimit, languages: [] }));
  if (req.url === '/legal') return res.end(JSON.stringify({
    legal: { name: 'Operator & <Example>', street: 'Example Street 1', zipCity: '12345 City', country: 'Deutschland', email: 'contact@example.test', phone: '', vatId: '', responsible: '' },
    tgContact: '@test_contact', retentionHours: 48, dailyLimit, licenseTtlDays: 9,
  }));
  res.statusCode = 404; res.end('{}');
});
backend.listen(0, '127.0.0.1');
await once(backend, 'listening');
let child;
try {
  for (const origin of ['https://subtitles.example.test', '']) {
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    child = spawn(process.execPath, ['server.js'], { cwd: standalone,
      env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port), SITE_URL: origin, MEDIA_API_URL: `http://127.0.0.1:${backend.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    child.stderr.on('data', data => { logs += data; });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try { ready = (await fetch(`${base}/api/health`)).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, logs);
    const get = async route => {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      return response.text();
    };
    for (const [route, lang, title] of [['/', 'en', 'Speak your language'], ['/uk', 'uk', 'Говоріть своєю мовою'], ['/seo', 'en', 'Add English subtitles'], ['/uk/seo', 'uk', 'Додайте англійські субтитри'], ['/impressum', 'de', 'Impressum'], ['/datenschutz', 'de', 'Datenschutzerklärung']]) {
      const html = await get(route);
      assert.ok(html.includes(`<html lang="${lang}"`), route);
      assert.ok(html.includes(title), route);
      assert.ok(html.includes('name="description"'), route);
      assert.ok(html.includes('id="content"'), route);
      assert.equal((html.match(/<h1[ >]/g) || []).length, 1, route);
      assert.doesNotMatch(html, /fonts.googleapis.com|Executive Brief/);
      if (origin) {
        assert.ok(html.includes(`rel="canonical" href="${origin}${route}"`), route);
      } else {
        assert.doesNotMatch(html, /rel="canonical"|https?:\/\/localhost/);
      }
    }
    const home = await get('/');
    assert.match(home, /99 MB/);
    assert.match(home, /6 minutes/);
    assert.match(home, /href="\/studio"/);
    dailyLimit = 8;
    assert.match(await get('/'), /8 free translations/); // Runtime config, no build-time snapshot.
    const legal = await get('/impressum');
    assert.match(legal, /Operator &amp; &lt;Example&gt;/);
    assert.doesNotMatch(legal, /<Example>/);
    assert.match(legal, /mailto:contact@example.test/);
    assert.match(await get('/datenschutz'), /contact@example.test/);
    for (const [from, to] of [['/ceo.html', '/seo'], ['/seo.html', '/seo'], ['/impressum.html', '/impressum'], ['/datenschutz.html', '/datenschutz'], ['/index.html', '/']]) {
      const redirect = await fetch(base + from + '?ref=old', { redirect: 'manual' });
      assert.equal(redirect.status, 308, from);
      const location = new URL(redirect.headers.get('location'), base);
      assert.equal(location.pathname, to);
      assert.equal(location.searchParams.get('ref'), 'old');
    }
    const sitemap = await get('/sitemap.xml');
    assert.equal((sitemap.match(/<loc>/g) || []).length, origin ? 6 : 0);
    assert.doesNotMatch(sitemap, /ceo|localhost|studio/);
    const robots = await get('/robots.txt');
    assert.match(robots, /Disallow: \/videos\//);
    if (origin) assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
    const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; child = undefined;
  }
  console.log('Public pages passed: SSR, EN/UK/DE, live config, HTML escaping, metadata, redirects, sitemap and unset SITE_URL.');
} finally {
  if (child) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
  await new Promise(resolve => backend.close(resolve));
}
