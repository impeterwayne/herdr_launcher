#!/usr/bin/env node
'use strict';
// Open the launcher as a popup.
//
//   node popup-launcher.js [--no-focus] [--dry-run]
//
// A plugin ACTION cannot itself be a popup — actions are non-interactive
// processes whose output herdr captures — so this is the one-line hop between
// the keybinding and the [[panes]] entry that IS one.
//
// The popup is the zero-width presentation: it is not part of the split tree, so
// it takes exact cell dimensions from the manifest and costs the layout nothing
// while it is closed. It is also a session-modal singleton, which is why nothing
// here tracks or stamps it: herdr keeps at most one, and it closes when the
// launcher process exits (q, esc, or launching something).

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
