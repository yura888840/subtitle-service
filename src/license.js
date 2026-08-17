'use strict';

const crypto = require('crypto');
const cfg = require('./config');

const COOKIE_NAME = 'license';

/** Constant-time comparison — don't leak key length/prefix via timing. */
function isValidKey(key) {
  if (typeof key !== 'string') return false;
  const a = Buffer.from(key);
  const b = Buffer.from(cfg.LICENSE_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Minimal cookie parser — avoids pulling in a dependency for one cookie. */
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}

/** Does this request carry a valid license cookie? */
function hasValidLicense(req) {
  return isValidKey(parseCookies(req)[COOKIE_NAME]);
}

/** Set the license cookie (httpOnly — JS can't read it, browser sends it). */
function setLicenseCookie(res, key) {
  const maxAge = cfg.LICENSE_TTL_DAYS * 24 * 60 * 60; // seconds
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(key)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax`);
}

module.exports = { isValidKey, hasValidLicense, setLicenseCookie };
