#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const npmCli = process.env.npm_execpath;
const outputDir = path.join(root, 'dist', 'binaries');
const entry = path.join(root, 'dist', 'cli.js');
const execOptions = { cwd: root, stdio: 'inherit' };

function runNpm(args) {
  if (npmCli) {
    childProcess.execFileSync(process.execPath, [npmCli, ...args], execOptions);
    return;
  }
  childProcess.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, execOptions);
}

fs.mkdirSync(outputDir, { recursive: true });
runNpm(['run', 'build']);

runNpm([
  'exec',
  '--yes',
  '--',
  'pkg',
  entry,
  '--targets',
  'node18-linux-x64,node18-macos-x64,node18-win-x64',
  '--out-path',
  outputDir,
], execOptions);

console.log(`[gtom] binaries written to ${outputDir}`);
