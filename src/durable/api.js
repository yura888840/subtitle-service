'use strict';
const store = require('./store');
const cfg = require('../config');
const license = require('../license');
async function dispatch(method, pathname, { body = {}, ip = '', cookie = '' } = {}) {
  const headers = { 'Cache-Control': 'no-store' };
  const licensed = license.hasValidLicense({ headers: { cookie } });
  let result;
  if (method === 'GET' && pathname === '/health') {
    await store.pool.query('SELECT 1'); result = { status: 'ok', durable: true };
  } else if (method === 'GET' && pathname === '/options') {
    result = { models: cfg.MODELS, languages: cfg.LANGUAGES, maxFileSizeMb: cfg.MAX_FILE_SIZE_MB, allowedExtensions: cfg.ALLOWED_EXTENSIONS, maxDurationSec: cfg.MAX_VIDEO_DURATION_SEC, dailyLimit: cfg.DAILY_LIMIT, tgContact: cfg.TG_CONTACT, support: cfg.SUPPORT_URL ? { url: cfg.SUPPORT_URL, name: cfg.SUPPORT_LINK_NAME } : null, durable: true };
  } else if (method === 'GET' && pathname === '/legal') {
    result = { legal: cfg.LEGAL, tgContact: cfg.TG_CONTACT, retentionHours: cfg.FILE_TTL_MS / 3600000, dailyLimit: cfg.DAILY_LIMIT, licenseTtlDays: cfg.LICENSE_TTL_DAYS };
  } else if (method === 'GET' && pathname === '/license/status') {
    result = { active: licensed, remaining: licensed ? null : await store.remaining(ip), dailyLimit: cfg.DAILY_LIMIT, tgContact: cfg.TG_CONTACT };
  } else if (method === 'POST' && pathname === '/license') {
    const key = String(body.key || '').trim();
    if (!license.isValidKey(key)) throw store.fail(400, 'Invalid license key.');
    license.setLicenseCookie({ setHeader: (key, value) => { headers[key] = value; } }, key);
    result = { ok: true, ttlDays: cfg.LICENSE_TTL_DAYS };
  } else if (method === 'POST' && pathname === '/apply') {
    result = await store.apply(String(body.jobId || ''), body.srt);
  } else if (method === 'GET' && /^\/sessions\/[^/]+$/.test(pathname)) {
    result = await store.sessionView(pathname.split('/')[2]);
  } else if (method === 'GET' && /^\/srt\/[^/]+$/.test(pathname)) {
    const s = await store.session(pathname.split('/')[2]);
    if (s.srt == null) throw store.fail(409, 'Transcription is not ready.');
    headers['Content-Type'] = 'application/x-subrip; charset=utf-8'; result = s.srt;
  } else if (method === 'GET' && /^\/jobs\/[^/]+$/.test(pathname)) {
    result = await store.getJob(pathname.split('/')[2]);
  } else if (method === 'POST' && /^\/jobs\/[^/]+\/cancel$/.test(pathname)) {
    result = await store.cancel(pathname.split('/')[2]);
  } else throw store.fail(404, 'Not found.');
  return { status: 200, body: result, headers };
}
module.exports = { dispatch };
