'use strict';
const crypto = require('crypto');
const name = 'subtitle_owner';
function secret() {
  const value = process.env.SESSION_SECRET || '';
  if (value.length < 32 || value.startsWith('replace-')) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return value;
}
function signature(id) { return crypto.createHmac('sha256', secret()).update(id).digest('hex'); }
function owner(cookie = '') {
  const token = cookie.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  const match = token.match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/);
  if (!match || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(match[1])) return null;
  return crypto.timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(signature(match[1]), 'hex')) ? match[1] : null;
}
function issue(cookie = '') {
  const existing = owner(cookie);
  if (existing) return { id: existing };
  const id = crypto.randomUUID();
  return { id, cookie: `${name}=${id}.${signature(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${process.env.COOKIE_SECURE === 'false' ? '' : '; Secure'}` };
}
module.exports = { owner, issue, validate: secret };
