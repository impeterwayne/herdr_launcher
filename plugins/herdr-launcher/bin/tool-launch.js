#!/usr/bin/env node
'use strict';

const path = require('node:path');
const h = require('../lib/herdr');
const dock = require('../lib/dock');
const { isOurs } = require('../lib/context');
const { byKey, TOOLS } = require('../lib/views');

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

const dryRun = argv.includes('--dry-run');

function report(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function main() {
  let panes = [];
  try {
    panes = h.paneList();
  } catch (err) {
    if (!dryRun) throw err;
  }

  const focused = panes.find((p) => p.focused) || panes[0] || null;
  const inTab = focused ? panes.filter((p) => p.tab_id === focused.tab_id) : [];
  const mine = inTab.filter(isOurs);

  if (mine.length) {
    const target = mine.find((p) => p.focused) || mine[0];
    if (dryRun) {
      return report({
        action: 'focus',
        tool: tool.key,
        pane: target.pane_id,
        target: 'sidebar',
      });
    }
    h.focusPane(target.pane_id);
    return report({ action: 'focused', tool: tool.key, pane: target.pane_id });
  }

  const avoid = mine.map((p) => p.pane_id);

  if (dryRun) {
    let target = null;
    if (focused) {
      try {
        const layout = h.paneLayout(focused.pane_id);
        target = dock.rightmostPane(layout, avoid);
      } catch (_) {}
    }
    return report({
      action: 'open',
      tool: tool.key,
      mode: 'sidebar',
      target: target ? target.pane_id : null,
      targetWidth: target ? target.rect.width : null,
      wantCols: dock.defaultCols(),
      command: dock.launchCommand({ view: tool.key }),
      cwd: focused ? focused.cwd : process.cwd(),
    });
  }

  if (!focused) {
    throw new Error('no active pane available — is a herdr session running?');
  }

  const opened = dock.open({
    anchorPane: focused.pane_id,
    cwd: focused.cwd,
    cols: dock.defaultCols(),
    focus: true,
    avoid,
    view: tool.key,
  });
  return report({ action: 'opened', tool: tool.key, mode: 'sidebar', ...opened });
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
