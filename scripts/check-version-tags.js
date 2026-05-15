#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');

const expectedTag = `gtom-v${pkg.version}`;

function git(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

try {
  const tags = git(['tag', '--points-at', 'HEAD'])
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.includes(expectedTag)) {
    console.log(`Version tag present: ${expectedTag}`);
    process.exit(0);
  }
  const message = `HEAD is not tagged ${expectedTag}. Create it with: git tag ${expectedTag}`;
  if (process.env.REQUIRE_VERSION_TAG === '1') {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
} catch (error) {
  console.error(`Version tag check failed: ${error.message}`);
  process.exit(1);
}
