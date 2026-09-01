#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const h = require('../lib/herdr');
const dock = require('../lib/dock');
const stash = require('../lib/stash');
const { isOurs, configDir, readConfig } = require('../lib/context');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const timeoutArg = argv.indexOf('--timeout');
const TIMEOUT_MS = timeoutArg !== -1 && argv[timeoutArg + 1] ? Number(argv[timeoutArg + 1]) : 15000;
const POLL_MS = 400;

const logFile = () => path.join(configDir(), 'startup.log');

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.appendFileSync(logFile(), line);
  } catch (_) {

  }
  process.stdout.write(line);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function settle() {
  const deadline = Date.now() + TIMEOUT_MS;
  let previous = null;
  let stable = 0;
  while (Date.now() < deadline) {
    let panes = null;
    try {
      panes = h.paneList();
    } catch (_) {
      panes = null;
    }
    if (panes && panes.length) {
      const signature = panes
        .map((p) => p.pane_id)
        .sort()
        .join(',');
      if (signature === previous) {
        stable += 1;
        if (stable >= 1) return panes;
      } else {
        stable = 0;
      }
      previous = signature;
    }
    sleep(POLL_MS);
  }
  try {
    return h.paneList();
  } catch (_) {
    return [];
  }
}

function startWatcher() {
  const child = spawn(process.execPath, [path.join(__dirname, 'watch-tabs.js'), '--start'], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
}

function main() {
  const panes = settle();
  if (!panes.length) {
    log('no panes after settle — nothing to adopt');
    return { action: 'noop', reason: 'no panes' };
  }

  const tabs = h.tabList();
  const adopted = [];
  const skipped = [];

  for (const tab of tabs) {
    if (stash.isStashTab(tab.label)) {
      skipped.push({ tab: tab.tab_id, reason: 'stash tab' });
      continue;
    }

    const orphans = dock.orphansIn(panes, tab.tab_id);
    const orphan = orphans.find((p) => dock.onRightEdge(p.pane_id)) || orphans[0] || null;
    if (orphan) {
      if (dryRun) {
        adopted.push({ tab: tab.tab_id, pane: orphan.pane_id, command: dock.launchCommand({ paneId: orphan.pane_id }) });
        continue;
      }
      const result = dock.adopt({ paneId: orphan.pane_id });
      log(`adopted ${result.pane} in ${tab.tab_id}`);
      adopted.push({ tab: tab.tab_id, ...result });
      continue;
    }

    const hasLiveLauncher = panes.some((p) => p.tab_id === tab.tab_id && isOurs(p) && !h.paneIsIdleShell(p.pane_id));
    if (hasLiveLauncher) {
      skipped.push({ tab: tab.tab_id, reason: 'launcher already live' });
      continue;
    }

    const autoDock = (readConfig('watch.json') || {}).autoDock !== false;
    if (autoDock) {
      if (dryRun) {
        adopted.push({ tab: tab.tab_id, action: 'dock', command: dock.launchCommand() });
        continue;
      }
      try {
        const result = dock.ensure({ tabId: tab.tab_id, panes, cols: dock.defaultCols(), focus: false });
        if (result) {
          log(`docked launcher in ${tab.tab_id}`);
          adopted.push({ tab: tab.tab_id, ...result });
          continue;
        }
      } catch (err) {
        log(`failed to dock in ${tab.tab_id}: ${err.message.split('\n')[0]}`);
      }
    }

    skipped.push({ tab: tab.tab_id, reason: 'no restored launcher pane' });
  }

  const pruned = dryRun ? [] : stash.prune(panes, tabs);
  if (pruned.length) log(`pruned focus-mode entries: ${JSON.stringify(pruned)}`);

  const autoDock = (readConfig('watch.json') || {}).autoDock !== false;
  const watch = autoDock && !argv.includes('--no-watch');
  if (watch && !dryRun) {
    startWatcher();
    log('tab watcher started (autoDock enabled)');
  }

  return { action: 'startup', adopted, skipped, pruned, watcher: watch ? 'started' : 'not started' };
}

try {
  process.stdout.write(`${JSON.stringify(main())}\n`);
} catch (err) {
  log(`failed: ${err.message.split('\n')[0]}`);
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
