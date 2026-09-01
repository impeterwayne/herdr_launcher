#!/usr/bin/env node
'use strict';

const h = require('../lib/herdr');
const dock = require('../lib/dock');
const { isOurs } = require('../lib/context');
const path = require('node:path');
const { spawn } = require('node:child_process');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const forceOpen = argv.includes('--open');
const forceClose = argv.includes('--close');
const colsArg = argv.indexOf('--cols');
const cols = colsArg !== -1 && argv[colsArg + 1] ? Number(argv[colsArg + 1]) : dock.defaultCols();

function startWatcher() {
  if (argv.includes('--no-watch')) return;
  const child = spawn(process.execPath, [path.join(__dirname, 'watch-tabs.js'), '--start'], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
}

function main() {
  const panes = h.paneList();
  const focused = panes.find((p) => p.focused);
  if (!focused) throw new Error('no focused pane — is a herdr session running?');

  const inTab = panes.filter((p) => p.tab_id === focused.tab_id);
  const mine = inTab.filter(isOurs);

  const deadMine = mine.filter((p) => h.paneIsIdleShell(p.pane_id));
  const liveMine = mine.filter((p) => !h.paneIsIdleShell(p.pane_id));

  if (deadMine.length > 0 && liveMine.length > 0) {
    for (const p of deadMine) {
      if (!dryRun) h.paneClose(p.pane_id);
    }
  }

  if (deadMine.length > 0 && liveMine.length === 0 && !forceClose) {
    const target = deadMine.find((p) => dock.onRightEdge(p.pane_id)) || deadMine[0];
    for (const p of deadMine) {
      if (p.pane_id !== target.pane_id && !dryRun) {
        h.paneClose(p.pane_id);
      }
    }
    if (dryRun) {
      return report({
        action: 'adopt',
        pane: target.pane_id,
        command: dock.launchCommand({ paneId: target.pane_id }),
      });
    }
    const result = dock.adopt({ paneId: target.pane_id });
    h.focusPane(target.pane_id);
    startWatcher();
    return report({ action: 'adopted', ...result });
  }

  if (liveMine.length && !forceOpen) {
    const focusedMine = liveMine.find((p) => p.focused);
    if (focusedMine || forceClose) {
      const target = focusedMine || liveMine[0];
      if (dryRun) return report({ action: 'close', pane: target.pane_id });
      h.paneClose(target.pane_id);
      return report({ action: 'closed', pane: target.pane_id });
    }
    if (dryRun) return report({ action: 'focus', pane: liveMine[0].pane_id });
    h.focusPane(liveMine[0].pane_id);
    return report({ action: 'focused', pane: liveMine[0].pane_id });
  }

  if (forceClose) {
    if (deadMine.length) {
      for (const p of deadMine) {
        if (!dryRun) h.paneClose(p.pane_id);
      }
      return report({ action: 'closed', panes: deadMine.map((p) => p.pane_id) });
    }
    return report({ action: 'noop', reason: 'no launcher pane in this tab' });
  }

  const avoid = mine.map((p) => p.pane_id);

  if (dryRun) {
    const layout = h.paneLayout(focused.pane_id);
    const target = dock.rightmostPane(layout, avoid);
    return report({
      action: 'open',
      target: target ? target.pane_id : null,
      targetWidth: target ? target.rect.width : null,
      wantCols: cols,
      command: dock.launchCommand(),
      cwd: focused.cwd,
    });
  }

  const opened = dock.open({
    anchorPane: focused.pane_id,
    cwd: focused.cwd,
    cols,
    focus: true,
    shim: argv.includes('--shim'),
    avoid,
  });
  startWatcher();
  return report({ action: 'opened', ...opened });
}

function report(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
