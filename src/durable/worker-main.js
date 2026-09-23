'use strict';
const fs = require('fs');
const cfg = require('../config');
const store = require('./store');
const { startWorker } = require('./worker');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the worker');
  fs.mkdirSync(cfg.OUTPUT_DIR, { recursive: true });
  await store.migrate();
  const worker = await startWorker();
  worker.finished.catch(err => { console.error(err); process.exit(1); });
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    setTimeout(() => process.exit(1), 10000).unref();
    await worker.stop(); await store.pool.end(); process.exit(0);
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch(err => { console.error(err); process.exit(1); });
