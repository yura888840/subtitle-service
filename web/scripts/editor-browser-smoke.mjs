import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

export async function testEditorBrowser(base) {
  const browser = await chromium.launch();
  const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const burnId = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const srt = '\uFEFF1\r\n00:00:00,000 --> 00:00:01,000\r\nHello\r\nworld\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\n<script>alert(1)</script>\r\n';
  async function open(configure = async () => {}, lang = 'en') {
    const page = await browser.newPage();
    await page.route('**/sessions/*', route => route.fulfill({ json: { sessionId, videoFile: 'test.mp4' } }));
    await page.route('**/srt/*', route => route.fulfill({ body: srt }));
    await configure(page);
    await page.goto(`${base}/editor?sessionId=${sessionId}&lang=${lang}`);
    return page;
  }
  try {
    const page = await open();
    await expect(page.locator('#cue-0')).toHaveValue('Hello\nworld');
    await expect(page.locator('#cue-1')).toHaveValue('<script>alert(1)</script>');
    await page.locator('video').evaluate(video => {
      Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 2.5 });
      video.dispatchEvent(new Event('timeupdate'));
    });
    await expect(page.locator('.cue.active textarea')).toHaveValue('<script>alert(1)</script>');
    await page.getByRole('button', { name: 'Seek to 00:00:00,000', exact: true }).click();
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 0);
    await page.locator('#cue-0').fill('');
    await expect(page.locator('#applyBtn')).toBeDisabled();
    await page.locator('#cue-0').fill('A\n\nB');
    await expect(page.locator('#applyBtn')).toBeDisabled();
    await page.locator('#cue-0').fill('Edited');
    await page.route('**/apply', route => route.fulfill({ status: 409, json: { error: 'Already rendering' } }));
    await page.locator('#applyBtn').click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Already rendering');
    await expect(page.locator('#cue-0')).toHaveValue('Edited');
    await expect(page.locator('#applyBtn')).toBeEnabled();
    await page.route('**/apply', route => route.abort());
    await page.locator('#applyBtn').click();
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
    await expect(page.locator('#applyBtn')).toBeEnabled();
    await page.close();

    for (const outcome of ['error', 'disconnect', 'leave']) {
      let socket, closed = false, submissions = 0;
      const worker = await open(async page => {
        await page.route('**/apply', route => { submissions++; return route.fulfill({ json: { jobId: burnId } }); });
        await page.routeWebSocket('**/ws?**', ws => { socket = ws; ws.onClose(() => { closed = true; }); ws.send(JSON.stringify({ status: 'queued', position: 2 })); });
      });
      await worker.locator('#cue-0').fill('Keep my edits');
      await worker.locator('#applyBtn').evaluate(button => { button.click(); button.click(); });
      await expect(worker.locator('main').getByRole('status')).toContainText('Position in queue: 2');
      assert.equal(submissions, 1);
      await expect(worker.locator('#cue-0')).toBeDisabled();
      socket.send(JSON.stringify({ status: 'processing', stage: 'burn' }));
      await expect(worker.locator('main').getByRole('status')).toContainText('Burning subtitles');
      if (outcome === 'leave') {
        await worker.locator('#resetBtn').click();
        await expect.poll(() => closed).toBe(true);
      } else {
        if (outcome === 'error') socket.send(JSON.stringify({ status: 'error', message: 'Burn failed' }));
        else await socket.close({ code: 1011 });
        await expect(worker.locator('main').getByRole('alert')).toContainText(outcome === 'error' ? 'Burn failed' : 'Connection lost');
        await expect(worker.locator('#cue-0')).toHaveValue('Keep my edits');
        await expect(worker.locator('#applyBtn')).toBeEnabled();
      }
      await worker.close();
    }
    const uk = await open(undefined, 'uk');
    await expect(uk).toHaveURL(`${base}/uk/editor?sessionId=${sessionId}`);
    await expect(uk.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(uk.getByRole('heading', { name: 'Редагуйте субтитри' })).toBeVisible();
    await uk.setViewportSize({ width: 390, height: 844 });
    assert.equal(await uk.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await uk.locator('#resetBtn').click();
    await expect(uk).toHaveURL(`${base}/uk/studio`);
    await uk.close();
    const malformed = await open(async page => {
      await page.route('**/srt/*', route => route.fulfill({ body: 'not an SRT file' }));
    });
    await expect(malformed.locator('main').getByRole('alert')).toContainText('Could not load');
    await expect(malformed.locator('#applyBtn')).toHaveCount(0);
    await malformed.route('**/srt/*', route => route.fulfill({ body: srt }));
    await malformed.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(malformed.locator('#cue-0')).toHaveValue('Hello\nworld');
    await malformed.close();
    console.log('React editor checks passed: SRT, playback selection, validation, duplicate submits, render failures, disconnect/cleanup, retry and UK/mobile.');
  } finally { await browser.close(); }
}
