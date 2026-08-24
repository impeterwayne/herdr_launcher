#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const api = require('../lib/api');
const dock = require('../lib/dock');
const h = require('../lib/herdr');
const stash = require('../lib/stash');
const { configDir, readConfig, writeConfig } = require('../lib/context');

const SELF = path.join(__dirname, 'watch-tabs.js');
const argv = process.argv.slice(2);
const colsArg = argv.indexOf('--cols');
const cols = colsArg !== -1 && argv[colsArg + 1] ? Number(argv[colsArg + 1]) : dock.defaultCols();

const pidFile = () => path.join(configDir(), 'watch-tabs.pid');
const logFile = () => path.join(configDir(), 'watch-tabs.log');

function rememberAutoDock(on) {
  try {
    writeConfig('watch.json', { ...(readConfig('watch.json') || {}), autoDock: Boolean(on) });
  } catch (_) {

  }
}

function isStashTabId(tabId) {
  try {
    const tab = h.tabList().find((t) => t.tab_id === tabId);
    return Boolean(tab && stash.isStashTab(tab.label));
  } catch (_) {
    return false;
  }
}

function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runningPid() {
  let pid;
  try {
    pid = Number(fs.readFileSync(pidFile(), 'utf8').trim());
  } catch (_) {
    return null;
  }
  if (!pid || pid === process.pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (_) {
    return null;
  }
}

function claimLock() {
  fs.mkdirSync(configDir(), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(pidFile(), String(process.pid), { encoding: 'utf8', flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (runningPid()) return false;
      try {
        fs.unlinkSync(pidFile());
      } catch (_) {

      }
    }
  }

  const release = () => {
    try {
      if (Number(fs.readFileSync(pidFile(), 'utf8').trim()) === process.pid) fs.unlinkSync(pidFile());
    } catch (_) {

    }
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => process.exit(0));
  }

  setInterval(() => {
    let owner = null;
    try {
      owner = Number(fs.readFileSync(pidFile(), 'utf8').trim());
    } catch (_) {
      owner = null;
    }
    if (owner !== process.pid) {
      log(`lock now held by ${owner === null ? 'nobody' : owner} — standing down`);
      process.exit(0);
    }
  }, 30000);
  return true;
}

function dockTab(tabId, why, { requireFresh = false, label = null } = {}) {
  if (label !== null ? stash.isStashTab(label) : isStashTabId(tabId)) {
    log(`skip ${tabId}: focus-mode stash tab`);
    return;
  }
  let panes;
  try {
    panes = h.paneList();
  } catch (err) {
    log(`skip ${tabId}: ${err.message.split('\n')[0]}`);
    return;
  }
  const inTab = panes.filter((p) => p.tab_id === tabId);
  if (!inTab.length) return;
  if (requireFresh && inTab.length > 1) {
    log(`skip ${tabId}: ${inTab.length} panes, not a fresh tab`);
    return;
  }
  try {
    const result = dock.ensure({ tabId, panes, cols, focus: false });
    if (result) log(`docked ${result.pane} in ${tabId} (${why})`);
  } catch (err) {
    log(`failed ${tabId}: ${err.message.split('\n')[0]}`);
  }
}

function dockAll(why) {
  const labels = new Map();
  try {
    for (const tab of h.tabList()) labels.set(tab.tab_id, tab.label);
  } catch (_) {

  }
  const panes = h.paneList();
  const tabs = [...new Set(panes.map((p) => p.tab_id))];
  for (const tabId of tabs) {
    dockTab(tabId, why, labels.has(tabId) ? { label: labels.get(tabId) } : {});
  }
}

function reconcileAll(why) {
  let panes;
  try {
    panes = h.paneList();
  } catch (err) {
    return;
  }
  const tabs = [...new Set(panes.map((p) => p.tab_id))];
  for (const tabId of tabs) {
    if (isStashTabId(tabId)) continue;
    try {
      const res = dock.reconcileTab({ tabId, panes, cols });
      if (res && res.action && res.action !== 'noop') {
        log(`reconciled ${tabId}: ${res.action} (${why})`);
      }
    } catch (err) {
      log(`reconcile error in ${tabId}: ${err.message.split('\n')[0]}`);
    }
  }
}

function watch() {
  const holder = runningPid();
  if (holder) {
    process.stdout.write(`already running (pid ${holder})\n`);
    return;
  }
  if (!claimLock()) {
    process.stdout.write(`already running (pid ${runningPid()})\n`);
    return;
  }
  rememberAutoDock(true);
  log(`watching events via ${api.socketPath()}`);

  try {
    dockAll('watcher-startup');
  } catch (err) {
    log(`initial sync error: ${err.message.split('\n')[0]}`);
  }

  let attempt = 0;
  let debounceTimer = null;
  const triggerReconcile = (why) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => reconcileAll(why), 80);
  };

  const periodicTimer = setInterval(() => {
    try {
      dockAll('periodic-check');
    } catch (_) {}
  }, 1500);

  const open = () => {
    let ready = false;
    api.subscribe(
      [
        'tab.created',
        'tab.closed',
        'pane.closed',
        'pane.exited',
        'layout.updated',
      ],
      (envelope) => {
        const type =
          (envelope.data && envelope.data.type) ||
          envelope.event ||
          envelope.type ||
          (envelope.params && envelope.params.event) ||
          (envelope.params && envelope.params.type) ||
          '';

        if (type === 'tab_created' || type === 'tab.created') {
          const tabData =
            (envelope.data && envelope.data.tab) ||
            (envelope.params && envelope.params.data && envelope.params.data.tab) ||
            (envelope.params && envelope.params.tab) ||
            envelope.tab ||
            envelope.data ||
            envelope.params ||
            {};

          const tabId =
            tabData.tab_id ||
            envelope.tab_id ||
            (envelope.data && envelope.data.tab_id) ||
            (envelope.params && envelope.params.tab_id);

          if (!tabId) {
            dockAll('tab.created-event');
            return;
          }

          if (tabData.pane_count > 1) {
            log(`skip ${tabId}: ${tabData.pane_count} panes, not a new tab`);
            return;
          }

          const label = typeof tabData.label === 'string' ? tabData.label : null;
          setTimeout(
            () =>
              dockTab(tabId, 'tab.created', {
                label,
              }),
            50
          );
        } else if (
          type === 'pane_closed' ||
          type === 'pane.closed' ||
          type === 'pane_exited' ||
          type === 'pane.exited' ||
          type === 'layout_updated' ||
          type === 'layout.updated'
        ) {
          triggerReconcile(type);
        }
      },
      {
        onReady: () => {
          ready = true;
          attempt = 0;
          try {
            dockAll('socket-ready');
          } catch (_) {}
        },
        onError: (err) => log(`socket error: ${err.message}`),
        onClose: () => {
          if (attempt >= 10) {
            log('herdr is gone — stopping');
            clearInterval(periodicTimer);
            process.exit(0);
          }
          const delay = Math.min(30000, 2 ** attempt * 1000);
          attempt += 1;
          log(`${ready ? 'disconnected' : 'connect failed'}, retrying in ${delay}ms`);
          setTimeout(open, delay);
        },
      }
    );
  };
  open();
}

function start() {
  rememberAutoDock(true);
  const existing = runningPid();
  if (existing) return `already running (pid ${existing})`;
  let out = 'ignore';
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    out = fs.openSync(logFile(), 'a');
  } catch (_) {

  }
  const args = [SELF];
  if (colsArg !== -1) args.push('--cols', String(cols));
  const child = spawn(process.execPath, args, {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();

  for (let waited = 0; waited < 500; waited += 50) {
    sleep(50);
    const owner = runningPid();
    if (owner === child.pid) return `started (pid ${child.pid})`;
    if (owner) return `already running (pid ${owner})`;
  }
  return `started (pid ${child.pid})`;
}

function stop() {
  rememberAutoDock(false);
  const pid = runningPid();
  if (!pid) {

    try {
      fs.unlinkSync(pidFile());
    } catch (_) {

    }
    return 'not running';
  }
  try {
    process.kill(pid);
  } catch (err) {
    return `could not stop ${pid}: ${err.message}`;
  }

  try {
    if (Number(fs.readFileSync(pidFile(), 'utf8').trim()) === pid) fs.unlinkSync(pidFile());
  } catch (_) {

  }
  return `stopped (pid ${pid})`;
}

try {
  if (argv.includes('--dry-run')) {
    const pid = runningPid();
    let action = 'watch';
    if (argv.includes('--start')) action = 'start';
    else if (argv.includes('--stop')) action = 'stop';
    else if (argv.includes('--status')) action = 'status';
    else if (argv.includes('--once')) action = 'dock-once';

    const autoDockVal = action === 'stop' ? false : (readConfig('watch.json') || {}).autoDock !== false;
    process.stdout.write(
      `${JSON.stringify({
        action,
        running: Boolean(pid),
        pid: pid || null,
        autoDock: autoDockVal,
        cols,
        dryRun: true,
      })}\n`
    );
  } else if (argv.includes('--stop')) process.stdout.write(`${stop()}\n`);
  else if (argv.includes('--status')) {
    const pid = runningPid();
    process.stdout.write(`${pid ? `running (pid ${pid})` : 'not running'}\n`);
  } else if (argv.includes('--once')) dockAll('--once');
  else if (argv.includes('--start')) process.stdout.write(`${start()}\n`);
  else watch();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
