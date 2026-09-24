'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
test('staging promotes only passing releases and rollback reuses prior images without deleting volumes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'shared'));
  fs.writeFileSync(path.join(root, 'shared/staging.env'), 'unused by fake Docker');
  fs.writeFileSync(path.join(root, 'shared/smoke.mp4'), 'fixture');
  fs.writeFileSync(path.join(root, 'bin/docker'), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_DOCKER_LOG"
if [[ "$*" = *'--format json'* ]]; then
  echo '{"services":{"web":{"environment":{"SITE_URL":"https://staging.example.test","SESSION_SECRET":"test-secret-with-more-than-32-characters","DATABASE_URL":"postgres://example"}}}}'
fi
`, { mode: 0o755 });
  const prepare = (sha, exit) => {
    const dir = path.join(root, 'releases', sha);
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(dir, 'src/durable'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/durable/ownership.js'), '');
    fs.writeFileSync(path.join(dir, 'scripts/staging-smoke.mjs'), `process.exit(${exit});`);
    return dir;
  };
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  const releaseA = prepare(a, 0), releaseB = prepare(b, 1);
  const run = (...args) => spawnSync('bash', ['scripts/staging-release.sh', ...args], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, TEST_DOCKER_LOG: `${root}/docker.log` }, encoding: 'utf8' });
  assert.equal(run('deploy', root, a).status, 0);
  assert.equal(fs.realpathSync(`${root}/current`), releaseA);
  assert.notEqual(run('deploy', root, b).status, 0);
  assert.equal(fs.realpathSync(`${root}/current`), releaseA);
  assert.equal(fs.existsSync(`${releaseB}/.cutover-ready`), false);
  assert.equal(fs.realpathSync(`${root}/previous`), releaseA);
  assert.equal(run('rollback', root).status, 0);
  assert.equal(fs.realpathSync(`${root}/current`), releaseA);
  const log = fs.readFileSync(`${root}/docker.log`, 'utf8');
  assert.match(log, /--project-name subtitle-staging/);
  assert.match(log, /up -d --no-build --force-recreate --wait gateway/);
  assert.doesNotMatch(log, /down|prune|volume rm/);
  assert.notEqual(run('deploy', root, 'bad-sha').status, 0);
});
