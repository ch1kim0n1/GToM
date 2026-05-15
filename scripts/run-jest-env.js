#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const env = { ...process.env };
const jestArgs = [];
const jestBin = path.join(path.dirname(require.resolve('jest/package.json')), 'bin', 'jest.js');

for (const arg of args) {
  if (/^[A-Z_][A-Z0-9_]*=/.test(arg)) {
    const [key, ...rest] = arg.split('=');
    env[key] = rest.join('=');
  } else {
    jestArgs.push(arg);
  }
}

const result = spawnSync(process.execPath, [
  jestBin,
  ...jestArgs,
], {
  stdio: 'inherit',
  env,
});

process.exit(result.status ?? 1);
