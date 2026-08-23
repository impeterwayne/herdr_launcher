#!/usr/bin/env node
'use strict';

const h = require('../lib/herdr');
const { byKey, TOOLS } = require('../lib/views');

const PLUGIN = 'herdr-launcher';

const argv = process.argv.slice(2);

function usage(code) {
  const keys = TOOLS.map((t) => `  ${t.key.padEnd(10)} ${t.label}`).join('\n');
  process.stderr.write(
    `usage: tool-launch.js <tool-key> [--no-focus] [--dry-run]\n\n${keys}\n`
  );
  process.exit(code);
}

if (!argv.length || argv[0] === '--help' || argv[0] === '-h') usage(argv.length ? 0 : 1);

const tool = byKey(argv[0]);
if (!tool) {
  process.stderr.write(`unknown tool key: ${argv[0]}\n`);
  usage(1);
}

const entrypoint = tool.popupEntrypoint || `${tool.key}-popup`;
const dryRun = argv.includes('--dry-run');

const args = ['plugin', 'pane', 'open', '--plugin', PLUGIN, '--entrypoint', entrypoint];
if (argv.includes('--no-focus')) args.push('--no-focus');

if (dryRun) {
  process.stdout.write(
    `${JSON.stringify({ action: 'open', tool: tool.key, entrypoint, command: [h.BIN, ...args] })}\n`
  );
} else {
  const result = h.tryHerdr(args);
  if (result === null) {
    process.stderr.write(`could not open the ${tool.label} popup — is a herdr session running?\n`);
    process.exit(1);
  }
  process.stdout.write(
    `${JSON.stringify({ action: 'opened', tool: tool.key, entrypoint })}\n`
  );
}
