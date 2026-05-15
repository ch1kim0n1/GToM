#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const outputDir = path.join(root, 'dist', 'binaries');
const entry = path.join(root, 'dist', 'cli.js');

fs.mkdirSync(outputDir, { recursive: true });
childProcess.execFileSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' });

childProcess.execFileSync(npx, [
  '--yes',
  'pkg',
  entry,
  '--targets',
  'node20-linux-x64,node20-macos-x64,node20-win-x64',
  '--out-path',
  outputDir,
], { cwd: root, stdio: 'inherit' });

console.log(`[gtom] binaries written to ${outputDir}`);
