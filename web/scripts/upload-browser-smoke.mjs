import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// Called against the actual Next/Nginx/Express stack by gateway-smoke.mjs.
// Error/state cases intercept transport; the happy path uses the real backend
// and its stub media executables, including the legacy editor's render stage.
export async function testUploadBrowser(base) {
  const browser = await chromium.launch();
  const file = { name: 'fixture.mp4', mimeType: 'video/mp4', buffer: Buffer.from('video fixture') };
  const contexts = [];
  const newPage = async () => {
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage();
    // The legacy editor's external fonts are unrelated to upload correctness.
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    page.setDefaultTimeout(10000);
    return page;
  };
  const choose = async page => {
    await expect(page.getByLabel('Whisper model', { exact: true })).toBeVisible();
    await page.getByLabel('Video file', { exact: true }).setInputFiles(file);
  };
  const submit = page => page.getByRole('button', { name: 'Upload and generate subtitles', exact: true });
  const jobId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  try {
    const page = await newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/studio`);
    await expect(submit(page)).toBeDisabled();
    await expect(page.getByLabel('Whisper model', { exact: true })).toBeVisible();
    await page.getByLabel('Video file', { exact: true }).setInputFiles({ ...file, name: 'wrong.txt' });
    await expect(page.locator('main').getByRole('alert')).toContainText('allowed format');
    await expect(submit(page)).toBeDisabled();
    await choose(page);
    await page.getByLabel('License key', { exact: true }).fill('invalid');
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Invalid license key');
    await page.getByLabel('License key', { exact: true }).fill('test-only-license');
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(page.getByText('License active — unlimited translations', { exact: true })).toBeVisible();
    assert.ok((await page.context().cookies()).some(cookie => cookie.name === 'license' && cookie.httpOnly));
    await choose(page);
    await page.getByLabel('Whisper model', { exact: true }).selectOption('medium');
    await page.getByLabel('Language spoken in the video', { exact: true }).selectOption('Ukrainian');
    let uploads = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/upload') uploads++; });
    await submit(page).click();
    await page.waitForURL('**/editor?**', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#editorView')).toBeVisible();
    await expect(page.locator('#cueList textarea')).toHaveValue('Hello');
    assert.equal(uploads, 1, 'handoff must not re-upload video');
    const session = new URL(page.url()).searchParams.get('sessionId');
    assert.ok(session);
    const cookies = await page.context().cookies();
    assert.equal(cookies.find(cookie => cookie.name === 'pref_language').value, 'Ukrainian');
    await page.locator('#cueList textarea').fill('Edited from React upload');
    await page.locator('#applyBtn').click();
    await expect(page.locator('#downloadVideoLink')).toBeVisible();
    assert.equal(await (await page.request.get(base + await page.locator('#downloadVideoLink').getAttribute('href'))).text(), '1\n00:00:00,000 --> 00:00:01,000\nEdited from React upload\n');
    await page.locator('#resetBtn').click();
    await page.waitForURL('**/studio');
    await expect(page.getByLabel('Language spoken in the video', { exact: true })).toHaveValue('Ukrainian');
    assert.deepEqual(errors, []);

    const ukrainian = await newPage();
    await ukrainian.goto(`${base}/studio?lang=uk`);
    await expect(ukrainian).toHaveURL(`${base}/uk/studio`);
    await expect(ukrainian.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(ukrainian.getByLabel('Відеофайл', { exact: true })).toBeVisible();
    await ukrainian.setViewportSize({ width: 390, height: 844 });
    assert.equal(await ukrainian.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    const unavailable = await newPage();
    let attempts = 0;
    await unavailable.route('**/options', route => ++attempts === 1 ? route.fulfill({ status: 503, json: {} }) : route.continue());
    await unavailable.goto(`${base}/studio`);
    await expect(unavailable.locator('main').getByRole('alert')).toContainText('Could not load upload options');
    await unavailable.locator('main').getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await choose(unavailable);

    const oversized = await newPage();
    const options = await (await fetch(`${base}/options`)).json();
    await oversized.route('**/options', route => route.fulfill({ json: { ...options, maxFileSizeMb: 1 } }));
    await oversized.goto(`${base}/studio`);
    await expect(oversized.getByLabel('Video file', { exact: true })).toBeVisible();
    await oversized.getByLabel('Video file', { exact: true }).setInputFiles({ ...file, buffer: Buffer.alloc(1024 * 1024 + 1) });
    await expect(oversized.locator('main').getByRole('alert')).toContainText('exceeds the size limit');
    await expect(submit(oversized)).toBeDisabled();

    for (const [status, error, visible] of [[429, 'quota', 'Daily limit reached'], [413, 'size', 'exceeds the size limit'], [400, 'Video is too long', 'Video is too long'], [500, 'Upload unavailable', 'Upload unavailable']]) {
      const failure = await newPage();
      await failure.route('**/upload', route => route.fulfill({ status, json: { error } }));
      await failure.goto(`${base}/studio`); await choose(failure); await submit(failure).click();
      await expect(failure.locator('main').getByRole('alert')).toContainText(visible);
      await expect(submit(failure)).toBeEnabled();
    }

    const network = await newPage();
    await network.route('**/upload', route => route.abort());
    await network.goto(`${base}/studio`); await choose(network); await submit(network).click();
    await expect(network.locator('main').getByRole('alert')).toContainText('Connection lost');

    const stream = await newPage();
    let socket;
    await stream.route('**/upload', route => route.fulfill({ json: { jobId } }));
    await stream.routeWebSocket('**/ws?**', ws => { socket = ws; ws.send(JSON.stringify({ status: 'queued', position: 2 })); });
    await stream.goto(`${base}/studio`); await choose(stream); await submit(stream).click();
    await expect(stream.getByRole('status')).toContainText('Position in queue: 2');
    await expect(submit(stream)).toBeDisabled();
    socket.send(JSON.stringify({ status: 'processing', stage: 'compress' }));
    await expect(stream.getByRole('status')).toContainText('Compressing video');
    socket.send(JSON.stringify({ status: 'processing', stage: 'transcribe' }));
    await expect(stream.getByRole('status')).toContainText('Generating English subtitles');
    await socket.close({ code: 1011, reason: 'test disconnect' });
    await expect(stream.locator('main').getByRole('alert')).toContainText('Connection to the worker was lost');
    await expect(submit(stream)).toBeEnabled();

    const processingError = await newPage();
    await processingError.route('**/upload', route => route.fulfill({ json: { jobId } }));
    await processingError.routeWebSocket('**/ws?**', ws => ws.send(JSON.stringify({ status: 'error', message: 'Transcription failed' })));
    await processingError.goto(`${base}/studio`); await choose(processingError); await submit(processingError).click();
    await expect(processingError.locator('main').getByRole('alert')).toContainText('Transcription failed');

    const progress = await newPage();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let uploadCount = 0;
    await progress.route('**/upload', async route => { uploadCount++; await held; await route.fulfill({ status: 400, json: { error: 'test complete' } }); });
    await progress.goto(`${base}/studio`); await choose(progress); await submit(progress).click();
    await expect(progress.getByRole('progressbar')).toBeVisible();
    // Repeated synchronous submits must not create two XHRs.
    await progress.locator('form[aria-label="Upload and generate subtitles"]').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(uploadCount, 1);
    release();
    await expect(progress.locator('main').getByRole('alert')).toContainText('test complete');

    const leaving = await newPage();
    let closed = false;
    await leaving.route('**/upload', route => route.fulfill({ json: { jobId } }));
    await leaving.routeWebSocket('**/ws?**', ws => { ws.onClose(() => { closed = true; }); ws.send(JSON.stringify({ status: 'queued', position: 1 })); });
    await leaving.goto(`${base}/studio`); await choose(leaving); await submit(leaving).click();
    await expect(leaving.getByRole('status')).toContainText('Position in queue: 1');
    await leaving.locator('.brand').click();
    await expect.poll(() => closed).toBe(true);

    const expired = await newPage();
    await expired.goto(`${base}/editor?sessionId=expired&lang=en`);
    await expect(expired.locator('#statusPanel')).toContainText('Please try again');
    console.log('Browser upload checks passed: validation, license, preferences, progress/queue/stages, errors, socket cleanup, EN/UK and real editor/render handoff.');
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
}
