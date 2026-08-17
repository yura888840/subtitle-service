'use strict';

function ts() {
  return new Date().toISOString();
}

module.exports = {
  info: (tag, msg) => console.log(`${ts()} [${tag}] ${msg}`),
  warn: (tag, msg) => console.warn(`${ts()} [${tag}] WARN ${msg}`),
  error: (tag, msg) => console.error(`${ts()} [${tag}] ERROR ${msg}`)
};
