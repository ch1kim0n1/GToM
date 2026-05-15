#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repeats = Number(process.env.FLAKY_REPEATS ?? 3);
const failures = [];
const jestBin = path.join(path.dirname(require.resolve('jest/package.json')), 'bin', 'jest.js');

for (let run = 1; run <= repeats; run++) {
  const result = spawnSync(process.execPath, [
    jestBin,
    '--runInBand',
    '--silent',
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      FLAKY_RUN: String(run),
    },
  });
  if (result.status !== 0) {
    if (result.error) {
      console.error(`Flaky detection run ${run} failed to start: ${result.error.message}`);
    }
    failures.push(run);
  }
}

if (failures.length > 0) {
  console.error(`Flaky detection failed on run(s): ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`Flaky detection passed across ${repeats} run(s).`);
