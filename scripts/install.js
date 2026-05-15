#!/usr/bin/env node

const childProcess = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args) {
  childProcess.execFileSync(npm, args, { cwd: root, stdio: 'inherit' });
}

try {
  run(['ci']);
} catch {
  run(['install']);
}

run(['rebuild', 'better-sqlite3']);
run(['run', 'build']);
run(['run', 'postinstall']);
