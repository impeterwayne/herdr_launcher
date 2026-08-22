#!/usr/bin/env node
'use strict';
// Open a GUI application at the active pane's directory, and raise its window.
//
//   node app-open.js <app-key> [path] [--no-focus] [--dry-run]
//
// Always spawns detached: a child of the invoking pane's PTY dies or blocks
// when that pane closes.

const { byKey, APPS, resolveApp, openApp } = require('../lib/apps');
const { resolveContext } = require('../lib/context');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const focus = !argv.includes('--no-focus');
const positional = argv.filter((a) => !a.startsWith('--'));

if (!positional.length || argv.includes('--help') || argv.includes('-h')) {
  const keys = APPS.map((a) => `  ${a.key.padEnd(18)} ${a.label}`).join('\n');
  process.stderr.write(`usage: app-open.js <app-key> [path] [--no-focus] [--dry-run]\n\n${keys}\n`);
  process.exit(positional.length ? 0 : 1);
}

const app = byKey(positional[0]);
if (!app) {
  process.stderr.write(`unknown app key: ${positional[0]}\n`);
  process.exit(1);
}

try {
  const cwd = positional[1] || resolveContext().cwd;
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ app: app.key, exe: resolveApp(app), cwd, focus }, null, 2)}\n`);
  } else {
    const exe = openApp(app, cwd, { focus });
    process.stdout.write(`launched ${app.label}: ${exe}\n  cwd: ${cwd}\n`);
  }
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
