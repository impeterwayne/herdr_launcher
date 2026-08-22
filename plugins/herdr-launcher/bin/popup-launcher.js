#!/usr/bin/env node
'use strict';

const h = require('../lib/herdr');

const PLUGIN = 'herdr-launcher';
const ENTRYPOINT = 'launcher-popup';

const argv = process.argv.slice(2);
const args = ['plugin', 'pane', 'open', '--plugin', PLUGIN, '--entrypoint', ENTRYPOINT];
if (argv.includes('--no-focus')) args.push('--no-focus');

if (argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify({ action: 'open', command: [h.BIN, ...args] })}\n`);
} else {
  const result = h.tryHerdr(args);
  if (result === null) {
    process.stderr.write('could not open the launcher popup — is a herdr session running?\n');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ action: 'opened', entrypoint: ENTRYPOINT })}\n`);
}
