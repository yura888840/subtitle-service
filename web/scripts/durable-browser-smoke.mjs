import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
export async function testDurableBrowser(base) {
  const browser = await chromium.launch();
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  try {
    const page = await browser.newPage();
    let status = 'processing', polls = 0;
    await page.route(`**/jobs/${id}`, route => { polls++; return route.fulfill({ json: { status, stage: 'transcribe', durable: true } }); });
    await page.route(`**/jobs/${id}/cancel`, route => { status = 'cancelled'; return route.fulfill({ json: { status } }); });
    await page.goto(`${base}/task?jobId=${id}`);
    await expect(page.getByRole('button', { name: 'Cancel job' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Cancel job' })).toBeVisible();
    assert.ok(polls >= 2);
    await page.getByRole('button', { name: 'Cancel job' }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('cancelled');
    status = 'processing';
    await page.route('**/sessions/*', route => route.fulfill({ json: { sessionId: id, videoFile: 'fixture.mp4', durable: true, renderJobId: id } }));
    await page.route('**/srt/*', route => route.fulfill({ body: '1\n00:00:00,000 --> 00:00:01,000\nSaved edit\n' }));
    await page.goto(`${base}/editor?sessionId=${id}`);
    await expect(page.locator('#cue-0')).toHaveValue('Saved edit');
    await expect(page.locator('#applyBtn')).toBeDisabled();
    await page.reload();
    await expect(page.locator('#applyBtn')).toBeDisabled();
    await page.route(`**/jobs/${id}`, route => route.fulfill({ json: { status: 'done', outputFile: 'result.mp4', durable: true } }));
    await expect(page.locator('#downloadVideoLink')).toBeVisible();
    await expect(page.locator('#applyBtn')).toBeEnabled();
    console.log('Durable browser checks passed: refresh restores task/render, explicit cancellation, saved text and recovered result.');
  } finally { await browser.close(); }
}
